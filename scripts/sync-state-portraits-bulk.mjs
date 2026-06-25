#!/usr/bin/env node
/**
 * sync-state-portraits-bulk.mjs — STATE & local official portraits, keyless.
 *
 * Why this exists: the OpenStates v3 API rate-limits per-key (≈250/day), so the
 * federal portrait sync's API path 429s and state legislators never get faces
 * (the bulk of ~9k missing portraits are state/local). The openstates/people
 * GitHub repo ships the SAME person data as YAML — including each person's
 * `image:` URL — and the repo tarball is keyless + unthrottled. We download it
 * once, map `ocd-person/{uuid}` -> image (our legislators.openstates_id is
 * exactly that id), and fill portrait_url for officials missing one.
 *
 * Real-data-only: the match key is the precise ocd-person UUID, so we never
 * guess a face. Hotlink by default (URL stored as-is; CSP img-src allows https,
 * <OfficialAvatar> is a plain <img> with an onError initials fallback, so an
 * occasionally-dead source URL degrades gracefully — never a wrong face). When
 * R2_* is configured we instead download + cache the bytes to our bucket.
 *
 * Free-tier, self-healing (bad file skipped, never aborts), telemetry via
 * scraper_runs source `state_portraits_bulk`. Runs anywhere (no box/key dep).
 *
 *   node --env-file=.env.local scripts/sync-state-portraits-bulk.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-state-portraits-bulk.mjs --state=OK
 *   node --env-file=.env.local scripts/sync-state-portraits-bulk.mjs --force --limit=200
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
const DRY = flag("dry-run");
const FORCE = flag("force");
const STATE = (opt("state") || "").toUpperCase() || null;
const LIMIT = parseInt(opt("limit") || "0", 10) || null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const TARBALL = "https://github.com/openstates/people/archive/refs/heads/main.tar.gz";
const UA = "iKratom-portraits/1.0 (+https://www.ikratom.org; contact@ikratom.org)";
const MAX_BYTES = 6 * 1024 * 1024, MIN_BYTES = 512;
const log = (...a) => console.log(...a);

// ---- R2 (only when fully configured) -----------------------------------
function r2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && process.env.R2_PUBLIC_BASE_URL);
}
let _r2 = null;
async function putToR2(key, body, contentType) {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  if (!_r2) _r2 = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  await _r2.send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${key}`;
}
const extFor = (ct) => ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";

// ---- download + parse the openstates/people repo into id->image ----------
async function loadBulkImageMap() {
  const dir = mkdtempSync(join(tmpdir(), "ospeople-"));
  const map = new Map();
  try {
    const res = await fetch(TARBALL, { headers: { "User-Agent": UA }, redirect: "follow" });
    if (!res.ok) throw new Error(`tarball http ${res.status}`);
    const tgz = join(dir, "people.tar.gz");
    writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
    // Extract only the per-person YAML under data/ (legislature, executive,
    // municipalities, retired — match key is the stable ocd-person id, folder
    // is irrelevant). Skip settings/committees/org files.
    await tar.x({ file: tgz, cwd: dir, filter: (p) => p.endsWith(".yml") && p.includes("/data/") });
    let parsed = 0;
    const walk = (d) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const fp = join(d, ent.name);
        if (ent.isDirectory()) { walk(fp); continue; }
        if (!ent.name.endsWith(".yml")) continue;
        try {
          const doc = yaml.load(readFileSync(fp, "utf8"));
          parsed++;
          if (doc && typeof doc.id === "string" && typeof doc.image === "string" && doc.image.startsWith("http")) {
            map.set(doc.id, doc.image);
          }
        } catch { /* skip malformed file */ }
      }
    };
    walk(dir);
    log(`  openstates/people: ${parsed} people parsed, ${map.size} with image`);
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  return map;
}

async function fetchBytes(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow" });
    if (!res.ok) return { ok: false };
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!ct.startsWith("image/")) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < MIN_BYTES || buf.length > MAX_BYTES) return { ok: false };
    return { ok: true, contentType: ct, bytes: buf };
  } catch { return { ok: false }; }
}

// Lightweight liveness check for hotlink mode: confirm the URL currently
// serves an image, WITHOUT downloading the bytes (cancel the body after the
// headers land). openstates' bulk `image` URLs include volatile state-.gov
// links that 404 — storing a dead URL just yields a broken <img> (so the user
// sees initials anyway) AND marks the row done so it's never retried. Skipping
// dead URLs keeps portrait_url null for a future run. A host that blocks our
// UA/GET fails closed (we skip, leave null) — safe, never a wrong face.
async function imageAlive(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, redirect: "follow" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return res.ok && ct.startsWith("image/");
  } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recentlyRan() {
  if (FORCE) return false;
  const { data } = await sb.from("scraper_runs").select("finished_at").eq("source", "state_portraits_bulk").eq("status", "success").order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at;
  if (!last) return false;
  return (Date.now() - new Date(last).getTime()) / 86400000 < 6;
}

async function main() {
  if (await recentlyRan()) { log("state_portraits_bulk ran <6d ago — skipping (use --force)."); return; }
  const useR2 = r2Configured();
  log(`state portraits (bulk) — ${DRY ? "DRY-RUN" : "LIVE"}${STATE ? ` state=${STATE}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}; R2=${useR2 ? "on" : "off (hotlink)"}`);

  await runWithLogging({ source: "state_portraits_bulk", supabase: sb }, async () => {
    const idToImage = await loadBulkImageMap();
    if (idToImage.size === 0) throw new Error("bulk image map empty — aborting (source unavailable)");

    // Full work-list, range-paginated past PostgREST's 1000-row cap.
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
    log(`${queue.length} officials with an openstates_id missing a portrait.`);

    let updated = 0, noMatch = 0, cached = 0, failed = 0, dead = 0;
    for (const leg of queue) {
      const img = idToImage.get(leg.openstates_id);
      if (!img) { noMatch++; continue; }
      let finalUrl = img, finalSrc = "openstates_bulk";
      if (useR2) {
        // Cache to our bucket (downloads + validates the bytes).
        const r = await fetchBytes(img);
        if (!r.ok) { dead++; continue; }
        try {
          finalUrl = await putToR2(`portraits/${leg.id}.${extFor(r.contentType)}`, r.bytes, r.contentType);
          finalSrc = "openstates_bulk+r2";
          cached++;
        } catch (e) { log(`  ! R2 ${leg.full_name}: ${String(e?.message ?? e).slice(0, 80)}`); failed++; continue; }
      } else {
        // Hotlink: only store URLs that currently serve an image (headers-only
        // check). Dead ones stay null for a later run / source.
        if (!(await imageAlive(img))) { dead++; await sleep(60); continue; }
      }
      if (!DRY) {
        const { error } = await sb.from("legislators")
          .update({ portrait_url: finalUrl, portrait_source: finalSrc, portrait_synced_at: new Date().toISOString() })
          .eq("id", leg.id);
        if (error) { log(`  ! update ${leg.full_name}: ${error.message}`); failed++; continue; }
      }
      updated++;
      if (!useR2) await sleep(60); // gentle pace for the per-row liveness GETs
    }
    const notes = `${DRY ? "dry-run " : ""}${updated} state portraits (${useR2 ? `${cached} R2-cached` : "hotlinked"}), ${dead} dead/unreachable, ${noMatch} no-match in bulk, ${failed} failed, of ${queue.length} queued`;
    log(`\n${notes}`);
    return { rowsAdded: 0, rowsUpdated: DRY ? 0 : updated, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
