#!/usr/bin/env node
/**
 * Phase 2 — Resolve Google News redirect URLs to publisher URLs.
 *
 * KEYLESS HTTP decode (lib/google-news-decode.mjs) — NO browser. Replaces the
 * old headless-Chromium resolver, which was ~7s/item, needed a 150MB binary,
 * and was increasingly walled by Google's consent / anti-bot screens so the
 * backlog (thousands of items) never cleared. The decoder calls Google's own
 * public batchexecute RPC to swap the opaque id for the publisher URL: verified
 * 10/10 across diverse publishers, ~1s/item, and runs in the ghost-server GHA
 * job (no Chromium). See the lib header for the mechanism.
 *
 * Reads active, classified news_items whose url is on news.google.com and whose
 * resolved_url IS NULL, decodes each, and stores resolved_url + resolved_at.
 *
 * Failure handling (fixes the old "strand on first failure" trap, where a
 * consent-walled item got resolved_at stamped WITHOUT a resolved_url and was
 * never retried): we stamp resolved_at only on PERMANENT failures (404/410
 * article, malformed id, RPC returned nothing). Transient failures (timeout,
 * 429, 5xx, missing markers) are left untouched so the next run retries them.
 *
 * Run:
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --limit 200
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --limit 500 --delay 800   # backlog clear
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --refresh --dry-run        # re-probe everything
 */
import { createClient } from "@supabase/supabase-js";
import { decodeGoogleNewsUrl } from "./lib/google-news-decode.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "200", 10);
const DELAY_MS = parseInt(arg("--delay") ?? "600", 10);
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let q = sb.from("news_items")
  .select("id, url, title, state")
  .eq("active", true)
  .ilike("url", "%news.google.com%")
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("resolved_url", null);

const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
if (!items || items.length === 0) { console.log("Nothing to resolve."); process.exit(0); }

console.log(`Resolving ${items.length} Google News redirects (keyless)${DRY_RUN ? " [DRY RUN]" : ""}…\n`);

let resolved = 0, permanent = 0, transient = 0;
const t0 = Date.now();

for (const it of items) {
  const tag = `[${(it.state ?? "?").padEnd(3)}] ${(it.title ?? "").slice(0, 60)}`;
  let res;
  try {
    res = await decodeGoogleNewsUrl(it.url);
  } catch (e) {
    res = { ok: false, reason: `throw:${e.message?.slice(0, 30)}`, permanent: false };
  }

  if (res.ok) {
    resolved++;
    console.log(`  ✓ ${tag} → ${res.url.slice(0, 56)}`);
    if (!DRY_RUN) {
      await sb.from("news_items").update({
        resolved_url: res.url.slice(0, 1000),
        resolved_at: new Date().toISOString(),
      }).eq("id", it.id);
    }
  } else if (res.permanent) {
    permanent++;
    console.log(`  ✗ ${tag} → ${res.reason} (give up)`);
    if (!DRY_RUN) {
      // Stamp resolved_at so we stop retrying a genuinely dead item.
      await sb.from("news_items").update({ resolved_at: new Date().toISOString() }).eq("id", it.id);
    }
  } else {
    transient++;
    console.log(`  … ${tag} → ${res.reason} (retry next run)`);
    // Leave untouched — the next run picks it up again.
  }

  await sleep(DELAY_MS);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — resolved=${resolved} gave-up=${permanent} retry-later=${transient}`);

if (!DRY_RUN) {
  try {
    await sb.from("scraper_runs").insert({
      source: "resolve_news_urls",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      // "empty" only if nothing resolved AND nothing left to retry; error if the
      // whole batch failed transiently (Google rate-limiting the run).
      status: resolved === 0 && transient === items.length ? "error"
        : resolved === 0 && permanent === 0 ? "empty" : "success",
      rows_updated: resolved,
      notes: `keyless decode: ${resolved} resolved, ${permanent} gave up, ${transient} retry-later`,
    });
  } catch { /* best-effort */ }
}

process.exit(0);
