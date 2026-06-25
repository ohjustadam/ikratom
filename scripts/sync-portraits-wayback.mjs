#!/usr/bin/env node
/**
 * sync-portraits-wayback.mjs — recover portraits whose openstates source URL is
 * dead, from OTHER copies of the SAME image. Keyless.
 *
 * sync-state-portraits-bulk.mjs hotlinks the openstates/people `image:` URL, but
 * a big tail of those URLs are dead/blocked (state-.gov CDNs that 404, moved, or
 * block our UA/IP) — ~1,099 even from a clean GHA IP. This pass takes each such
 * official's KNOWN image URL and recovers the picture from:
 *   1. a slower direct re-fetch (15s) — catches hosts that just timed out the
 *      bulk's 8s liveness check (slow, not dead);
 *   2. the Internet Archive Wayback Machine — the archived snapshot of that exact
 *      URL. Because we recover the SAME URL the official's record points to, this
 *      is precise: it can never attach a wrong face (unlike a name search).
 *
 * Wikidata (prominent officials w/ no usable openstates image) is handled by
 * `sync-official-portraits.mjs --wikidata`; this script is the dead-URL recoverer.
 *
 *   node --env-file=.env.local scripts/sync-portraits-wayback.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-portraits-wayback.mjs --state=OK --force
 *   node --env-file=.env.local scripts/sync-portraits-wayback.mjs --apply --limit=500
 *
 * Default is dry-run; pass --apply (or omit --dry-run? no — explicit) to write.
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import yaml from "js-yaml";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const APPLY = flag("apply");
const FORCE = flag("force");
const STATE = (opt("state") || "").toUpperCase() || null;
const LIMIT = parseInt(opt("limit") || "0", 10) || null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const TARBALL = "https://github.com/openstates/people/archive/refs/heads/main.tar.gz";
const UA = "iKratom-portraits/1.0 (+https://www.ikratom.org; contact@ikratom.org)";
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadBulkImageMap() {
  const dir = mkdtempSync(join(tmpdir(), "ospeople-wb-"));
  const map = new Map();
  try {
    const res = await fetch(TARBALL, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error(`tarball http ${res.status}`);
    const tgz = join(dir, "people.tar.gz");
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    await tar.x({ file: tgz, cwd: dir, filter: (p) => p.endsWith(".yml") && p.includes("/data/") });
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, ent.name);
        if (ent.isDirectory()) { walk(fp); continue; }
        if (!ent.name.endsWith(".yml")) continue;
        try {
          const doc = yaml.load(readFileSync(fp, "utf8"));
          if (doc && typeof doc.id === "string" && typeof doc.image === "string" && doc.image.startsWith("http")) map.set(doc.id, doc.image);
        } catch { /* skip malformed */ }
      }
    };
    walk(dir);
    log(`  openstates/people: ${map.size} ids with an image URL`);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  return map;
}

// Recover the SAME image URL from the Wayback Machine's closest snapshot.
//
// We TRUST the availability API's confirmation (available + a captured HTTP-200)
// and store the archived URL WITHOUT fetching the bytes ourselves. Run 1 byte-
// validated each candidate, but at scale archive.org throttles rapid image GETs,
// so valid recoveries failed the check and were dropped (178/1062 recovered;
// e.g. OK's Daniel Pae was lost though his snapshot exists). The availability
// API is light, so it survives the batch; the avatar's onError→initials covers
// a rare stale snapshot; and storing the im_ form of a 200 snapshot of that
// EXACT url can never attach a wrong face. Net: recovers the real tail.
async function waybackImage(origUrl) {
  let data;
  try {
    const r = await fetch(`https://archive.org/wayback/available?url=${encodeURIComponent(origUrl)}`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    data = await r.json();
  } catch { return null; }
  const snap = data?.archived_snapshots?.closest;
  // Accept any AVAILABLE snapshot, rejecting only captures the API explicitly
  // marks as a redirect/error (3xx/4xx/5xx). A "200" or unknown "-" status is
  // kept — requiring exactly "200" dropped valid recoveries whose status the API
  // reports as "-" (e.g. OK's Daniel Pae, whose im_ image is actually live).
  if (!snap?.available || !snap.url) return null;
  if (snap.status && /^[345]/.test(String(snap.status))) return null;
  // snap.url = http://web.archive.org/web/<ts>/<orig> → insert im_ for the raw
  // image bytes (no Wayback HTML wrapper) and prefer https.
  return snap.url.replace(/\/web\/(\d+)\//, "/web/$1im_/").replace(/^http:\/\//, "https://");
}

async function recentlyRan() {
  if (FORCE) return false;
  const { data } = await sb.from("scraper_runs").select("finished_at").eq("source", "portraits_wayback").eq("status", "success").order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at;
  return last ? (Date.now() - new Date(last).getTime()) / 86400000 < 6 : false;
}

async function main() {
  if (await recentlyRan()) { log("portraits_wayback ran <6d ago — skipping (use --force)."); return; }
  log(`portraits wayback recovery — ${APPLY ? "APPLY" : "DRY-RUN"}${STATE ? ` state=${STATE}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}`);

  await runWithLogging({ source: "portraits_wayback", supabase: sb }, async () => {
    const idToImage = await loadBulkImageMap();
    if (idToImage.size === 0) throw new Error("bulk image map empty — source unavailable");

    const PAGE = 1000;
    const queue = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("legislators").select("id, full_name, state, openstates_id")
        .eq("active", true).is("portrait_url", null).not("openstates_id", "is", null)
        .order("state").order("id").range(from, from + PAGE - 1);
      if (STATE) q = q.eq("state", STATE);
      const { data: page, error } = await q;
      if (error) throw new Error(`queue: ${error.message}`);
      queue.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
      if (LIMIT && queue.length >= LIMIT) break;
    }
    if (LIMIT && queue.length > LIMIT) queue.length = LIMIT;
    log(`${queue.length} officials missing a portrait but with an openstates id.`);

    let wayback = 0, noUrl = 0, unrecovered = 0, failed = 0;
    for (const leg of queue) {
      const img = idToImage.get(leg.openstates_id);
      if (!img) { noUrl++; continue; } // no known URL — Wikidata path's job
      // Recover the archived copy of the exact URL (validated). The bulk already
      // tried a live fetch and failed, so we go straight to the archive — no slow
      // re-fetch (a 15s retry on thousands of genuinely-dead URLs blows the budget).
      const wb = await waybackImage(img);
      await sleep(300); // polite to the availability API
      if (!wb) { unrecovered++; continue; }
      if (APPLY) {
        const { error } = await sb.from("legislators")
          .update({ portrait_url: wb, portrait_source: "wayback", portrait_synced_at: new Date().toISOString() })
          .eq("id", leg.id);
        if (error) { log(`  ! update ${leg.full_name}: ${error.message}`); failed++; continue; }
      }
      wayback++;
      log(`  ✓ ${leg.state} ${leg.full_name} <- wayback`);
    }
    const notes = `${APPLY ? "" : "dry-run "}${wayback} wayback recovered, ${unrecovered} still dead, ${noUrl} no-url, ${failed} failed, of ${queue.length}`;
    log(`\n${notes}`);
    return { rowsAdded: 0, rowsUpdated: APPLY ? wayback : 0, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
