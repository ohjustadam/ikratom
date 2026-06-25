#!/usr/bin/env node
/**
 * recache-portraits-to-r2.mjs — migrate hotlinked portraits into our R2 bucket.
 *
 * The portrait syncs (sync-official-portraits / sync-state-portraits-bulk) store
 * a third-party source URL directly ("hotlink") when R2 isn't configured. Once
 * R2_* env is set we own the assets: this one-time (re-runnable) migration
 * re-fetches each non-R2 portrait, uploads the bytes to portraits/{id}.{ext} in
 * the bucket, and rewrites portrait_url -> the R2 public URL (portrait_source
 * suffixed "+r2"). Idempotent: rows already on R2 (source ends "+r2") are
 * skipped, so re-runs only pick up newly-hotlinked portraits.
 *
 * Requires R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET /
 * R2_PUBLIC_BASE_URL — aborts if any is missing (nothing to migrate to).
 * Self-heals (a dead source URL is skipped, never aborts). Telemetry:
 * scraper_runs source `portraits_r2_recache`.
 *
 *   node --env-file=.env.local scripts/recache-portraits-to-r2.mjs --dry-run
 *   node --env-file=.env.local scripts/recache-portraits-to-r2.mjs --limit=50
 *   node --env-file=.env.local scripts/recache-portraits-to-r2.mjs --state=OK
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : null; };
const DRY = flag("dry-run");
const STATE = (opt("state") || "").toUpperCase() || null;
const LIMIT = parseInt(opt("limit") || "0", 10) || null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

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
const UA = "iKratom-portraits/1.0 (+https://www.ikratom.org; contact@ikratom.org)";
const MAX_BYTES = 6 * 1024 * 1024, MIN_BYTES = 512;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

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

async function main() {
  if (!r2Configured()) { console.error("R2 not configured (need R2_ACCOUNT_ID/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET/PUBLIC_BASE_URL). Nothing to migrate to."); process.exit(1); }
  log(`portraits R2 recache — ${DRY ? "DRY-RUN" : "LIVE"}${STATE ? ` state=${STATE}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}; bucket=${process.env.R2_BUCKET}`);

  await runWithLogging({ source: "portraits_r2_recache", supabase: sb }, async () => {
    // Full work-list, range-paginated past the 1000-row cap: portraits that
    // have a URL but aren't on R2 yet.
    const PAGE = 1000;
    const queue = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("legislators").select("id, full_name, state, portrait_url, portrait_source")
        .eq("active", true).not("portrait_url", "is", null)
        .order("state").order("id").range(from, from + PAGE - 1);
      if (STATE) q = q.eq("state", STATE);
      const { data: page, error } = await q;
      if (error) throw new Error(`queue: ${error.message}`);
      // Skip rows already on R2 (source ends "+r2").
      for (const r of page ?? []) {
        if (!String(r.portrait_source ?? "").endsWith("+r2")) queue.push(r);
      }
      if (!page || page.length < PAGE) break;
      if (LIMIT && queue.length >= LIMIT) break;
    }
    if (LIMIT && queue.length > LIMIT) queue.length = LIMIT;
    log(`${queue.length} portraits to migrate to R2.`);

    let migrated = 0, dead = 0, failed = 0;
    for (const leg of queue) {
      const r = await fetchBytes(leg.portrait_url);
      if (!r.ok) { dead++; await sleep(40); continue; } // source gone — leave as-is for a future sync
      let r2url;
      try {
        r2url = await putToR2(`portraits/${leg.id}.${extFor(r.contentType)}`, r.bytes, r.contentType);
      } catch (e) { log(`  ! R2 put ${leg.full_name}: ${String(e?.message ?? e).slice(0, 80)}`); failed++; continue; }
      if (!DRY) {
        const newSrc = `${leg.portrait_source ?? "source"}+r2`;
        const { error } = await sb.from("legislators")
          .update({ portrait_url: r2url, portrait_source: newSrc, portrait_synced_at: new Date().toISOString() })
          .eq("id", leg.id);
        if (error) { log(`  ! update ${leg.full_name}: ${error.message}`); failed++; continue; }
      }
      migrated++;
      await sleep(40);
    }
    const notes = `${DRY ? "dry-run " : ""}${migrated} migrated to R2, ${dead} dead source (left as-is), ${failed} failed, of ${queue.length} candidates`;
    log(`\n${notes}`);
    return { rowsAdded: 0, rowsUpdated: DRY ? 0 : migrated, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
