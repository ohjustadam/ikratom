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
 * An error page is never the answer (2026-11-24: 44 rows held
 * `chrome-error://chromewebdata/`). A decoded URL that fails
 * isUsableResolvedUrl() counts as transient: nothing is stored, and the next
 * run tries again. Migration 0330 enforces the same rule in the database.
 *
 * Twins: one story arrives under several Google News URLs. When a row resolves
 * to a URL another story already has, migration 0330's trigger marks it as that
 * story's duplicate, so feeds show it once and the extractor skips it. The
 * run's summary counts those as "twins".
 *
 * Run:
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --limit 200
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --limit 500 --delay 800   # backlog clear
 *   node --env-file=.env.local scripts/resolve-news-urls.mjs --refresh --dry-run        # re-probe everything
 */
import { createClient } from "@supabase/supabase-js";
import { decodeGoogleNewsUrl } from "./lib/google-news-decode.mjs";
import { isUsableResolvedUrl } from "./lib/news-resolved-url.mjs";

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

let resolved = 0, permanent = 0, transient = 0, writeErrors = 0;
const resolvedIds = [];
const t0 = Date.now();

for (const it of items) {
  const tag = `[${(it.state ?? "?").padEnd(3)}] ${(it.title ?? "").slice(0, 60)}`;
  let res;
  try {
    res = await decodeGoogleNewsUrl(it.url);
  } catch (e) {
    res = { ok: false, reason: `throw:${e.message?.slice(0, 30)}`, permanent: false };
  }
  if (res.ok && !isUsableResolvedUrl(res.url)) {
    res = { ok: false, reason: `error-page:${res.url.slice(0, 40)}`, permanent: false };
  }

  if (res.ok) {
    console.log(`  ✓ ${tag} → ${res.url.slice(0, 56)}`);
    if (DRY_RUN) { resolved++; }
    else {
      const { error: upErr } = await sb.from("news_items").update({
        resolved_url: res.url.slice(0, 1000),
        resolved_at: new Date().toISOString(),
      }).eq("id", it.id);
      if (upErr) { writeErrors++; console.log(`    ✗ write failed: ${upErr.message}`); }
      else { resolved++; resolvedIds.push(it.id); }
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

// How many resolved into a story we already had (the 0330 trigger linked them).
let twins = 0;
for (let i = 0; i < resolvedIds.length; i += 200) {
  const { count } = await sb.from("news_items")
    .select("id", { count: "exact", head: true })
    .in("id", resolvedIds.slice(i, i + 200))
    .not("duplicate_of", "is", null);
  twins += count ?? 0;
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — resolved=${resolved} (twins=${twins}) gave-up=${permanent} retry-later=${transient}${writeErrors ? ` write-errors=${writeErrors}` : ""}`);

if (!DRY_RUN) {
  try {
    await sb.from("scraper_runs").insert({
      source: "resolve_news_urls",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      // "empty" only if nothing resolved AND nothing left to retry; error if the
      // whole batch failed transiently (Google rate-limiting the run) or every
      // write failed.
      status: resolved === 0 && (transient + writeErrors) === items.length ? "error"
        : resolved === 0 && permanent === 0 ? "empty" : "success",
      rows_updated: resolved,
      notes: `keyless decode: ${resolved} resolved (${twins} twins of a story we had), ${permanent} gave up, ${transient} retry-later${writeErrors ? `, ${writeErrors} write errors` : ""}`,
    });
  } catch { /* best-effort */ }
}

process.exit(0);
