#!/usr/bin/env node
/**
 * sync-official-portraits.mjs — faces everywhere (Officials Intelligence).
 *
 * Fills legislators.portrait_url for active officials missing one, from FREE
 * public sources in priority order:
 *
 *   1. FEDERAL (role us_senate/us_house + bioguide_id) -> the @unitedstates
 *      project's public-domain congress photos:
 *        https://unitedstates.github.io/images/congress/450x550/{bioguide}.jpg
 *      Keyless, no account, hotlink-safe (it exists for exactly this use).
 *   2. STATE (openstates_id) -> now handled by sync-state-portraits-bulk.mjs.
 *      The OpenStates v3 API rate-limits per-key (≈250/day) and 429s at the
 *      ~7k-state-legislator scale, so we moved state portraits to the keyless
 *      openstates/people repo tarball. This script is FEDERAL-only now.
 *   3. (--wikidata, OFF by default) Wikidata P18 by exact label + US-politician
 *      constraint. Conservative on purpose: a WRONG face violates real-data-only,
 *      so this fallback is opt-in and only accepts an unambiguous single match.
 *
 * Caching: if R2_* env is configured we download the bytes and cache them to
 * our own bucket (portraits/{id}.{ext}) so we don't hotlink third-party CDNs;
 * otherwise we validate the source URL serves an image/* and store that https
 * URL directly (CSP img-src allows any https host; <OfficialAvatar> is a plain
 * <img>). portrait_source records provenance ("unitedstates", "openstates",
 * "wikidata", suffixed "+r2" when cached).
 *
 * Free-tier compliant. Self-heals (bad item skipped, never aborts the run).
 * Telemetry: scraper_runs source `official_portraits_sync`. Runs anywhere
 * (no box dependency). Registered weekly in check-cron-staleness.mjs.
 *
 *   node --env-file=.env.local scripts/sync-official-portraits.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-official-portraits.mjs --state=OK
 *   node --env-file=.env.local scripts/sync-official-portraits.mjs --force --limit=50
 *   node --env-file=.env.local scripts/sync-official-portraits.mjs --wikidata
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY = flag("dry-run");
const FORCE = flag("force");
const USE_WIKIDATA = flag("wikidata");
const STATE = (opt("state") || "").toUpperCase() || null;
const LIMIT = parseInt(opt("limit") || "0", 10) || null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MAX_BYTES = 6 * 1024 * 1024;
const MIN_BYTES = 512;
const UA = "iKratom-portraits/1.0 (+https://www.ikratom.org; contact@ikratom.org)";
const FEDERAL_ROLES = new Set(["us_senate", "us_house"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---- R2 (only used when fully configured) ------------------------------
function r2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
  );
}
let _r2 = null;
async function r2Client() {
  if (_r2) return _r2;
  const { S3Client } = await import("@aws-sdk/client-s3");
  _r2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return _r2;
}
async function putToR2(key, body, contentType) {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await r2Client();
  await client.send(
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType })
  );
  const base = process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "");
  return `${base}/${key}`;
}
function extFor(contentType) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

// ---- image fetch/validate ----------------------------------------------
// download=true keeps bytes (for R2 cache); else just confirms it's a real image.
async function fetchImage(url, download) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) return { ok: false, reason: `content-type ${ct || "none"}` };
    if (!download) {
      try { await res.arrayBuffer(); } catch { /* drain */ }
      return { ok: true, contentType: ct };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES) return { ok: false, reason: `too small (${buf.length}b)` };
    if (buf.length > MAX_BYTES) return { ok: false, reason: `too big (${buf.length}b)` };
    return { ok: true, contentType: ct, bytes: buf };
  } catch (e) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 120) };
  }
}

// ---- Wikidata P18 (opt-in, conservative) --------------------------------
async function wikidataPortrait(fullName, stateAbbr) {
  // Exact-label human who held a US public office; require a SINGLE match to
  // avoid attributing the wrong person's photo. Best-effort; returns url|null.
  const safe = fullName.replace(/["\\]/g, " ").trim();
  if (safe.length < 4) return null;
  const sparql = `SELECT ?img WHERE {
    ?p rdfs:label "${safe}"@en ; wdt:P31 wd:Q5 ; wdt:P18 ?img .
    ?p wdt:P27 wd:Q30 .
    { ?p wdt:P39 ?pos } UNION { ?p p:P39 ?st }
  } LIMIT 3`;
  try {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows = json.results?.bindings ?? [];
    const imgs = [...new Set(rows.map((r) => r.img?.value).filter(Boolean))];
    if (imgs.length !== 1) return null; // ambiguous or none -> skip (real-data-only)
    return imgs[0];
  } catch {
    return null;
  }
}

// ---- self-gate (weekly) --------------------------------------------------
async function recentlyRan() {
  if (FORCE) return false;
  const { data } = await sb
    .from("scraper_runs")
    .select("finished_at")
    .eq("source", "official_portraits_sync")
    .eq("status", "success")
    .order("finished_at", { ascending: false })
    .limit(1);
  const last = data?.[0]?.finished_at;
  if (!last) return false;
  const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
  return ageDays < 6;
}

async function main() {
  if (await recentlyRan()) {
    log("official_portraits_sync ran successfully <6d ago — skipping (use --force to override).");
    return;
  }
  log(`portraits sync — ${DRY ? "DRY-RUN" : "LIVE"}${STATE ? ` state=${STATE}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}; R2=${r2Configured() ? "on" : "off (hotlink)"}; wikidata=${USE_WIKIDATA ? "on" : "off"}`);

  await runWithLogging({ source: "official_portraits_sync", supabase: sb }, async () => {
    // Build the FULL work-list. PostgREST caps a single select at 1000 rows,
    // so paginate by range — otherwise (ordered by state) a run only ever sees
    // the first 1000 missing-portrait officials, and since it sets portrait_url
    // as it goes, repeat runs never advance past stuck early-alphabet rows
    // (the 1000-row-cap window-strand trap). Secondary .order("id") keeps the
    // range pagination deterministic. We snapshot the whole list before any
    // write, so the set doesn't shift under us mid-run.
    const PAGE = 1000;
    const queue = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb
        .from("legislators")
        .select("id, full_name, state, role, bioguide_id, openstates_id")
        .eq("active", true)
        .is("portrait_url", null)
        .order("state")
        .order("id")
        .range(from, from + PAGE - 1);
      if (STATE) q = q.eq("state", STATE);
      const { data: page, error } = await q;
      if (error) throw new Error(`queue query: ${error.message}`);
      queue.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
      if (LIMIT && queue.length >= LIMIT) break;
    }
    if (LIMIT && queue.length > LIMIT) queue.length = LIMIT;
    log(`${queue.length} active officials missing a portrait.`);

    let updated = 0, federal = 0, state = 0, wiki = 0, missed = 0, cached = 0;
    const useR2 = r2Configured();

    for (const leg of queue) {
      // ordered candidate sources
      const candidates = [];
      if (FEDERAL_ROLES.has(leg.role) && leg.bioguide_id) {
        candidates.push({ src: "unitedstates", url: `https://unitedstates.github.io/images/congress/450x550/${leg.bioguide_id}.jpg` });
      }
      if (USE_WIKIDATA && candidates.length === 0) {
        const w = await wikidataPortrait(leg.full_name, leg.state);
        if (w) candidates.push({ src: "wikidata", url: w });
      }

      let done = false;
      for (const cand of candidates) {
        const r = await fetchImage(cand.url, useR2);
        if (!r.ok) { continue; }
        let finalUrl = cand.url;
        let finalSrc = cand.src;
        if (useR2 && r.bytes) {
          const key = `portraits/${leg.id}.${extFor(r.contentType)}`;
          if (!DRY) finalUrl = await putToR2(key, r.bytes, r.contentType);
          else finalUrl = `${(process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "")}/${key}`;
          finalSrc = `${cand.src}+r2`;
          cached++;
        }
        if (!DRY) {
          const { error: upErr } = await sb
            .from("legislators")
            .update({ portrait_url: finalUrl, portrait_source: finalSrc, portrait_synced_at: new Date().toISOString() })
            .eq("id", leg.id);
          if (upErr) { log(`  ! update ${leg.full_name}: ${upErr.message}`); break; }
        }
        updated++;
        if (cand.src === "unitedstates") federal++;
        else if (cand.src === "openstates") state++;
        else wiki++;
        log(`  ✓ ${leg.state} ${leg.full_name} <- ${finalSrc}`);
        done = true;
        break;
      }
      if (!done) { missed++; }
      // Only pace when we actually hit the network this row. Most of the
      // ~9k queue are local/state officials with no working source today, so
      // unconditional sleeping would waste ~18min/run doing nothing.
      if (candidates.length > 0) await sleep(120);
    }

    const notes = `${DRY ? "dry-run " : ""}${updated} portraits (${federal} federal / ${state} openstates / ${wiki} wikidata${useR2 ? `, ${cached} R2-cached` : ", hotlinked"}), ${missed} no-source, of ${queue.length} queued`;
    log(`\n${notes}`);
    return { rowsAdded: 0, rowsUpdated: DRY ? 0 : updated, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
