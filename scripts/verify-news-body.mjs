#!/usr/bin/env node
/**
 * Verify each kratom-classified news_item is actually about kratom.
 *
 * Two-phase pipeline:
 *
 *   PHASE 1 (cheap, no network): check the article TITLE + SUMMARY for
 *     any kratom keyword. Items with NO keyword get marked FP — Google
 *     News returned them because the source page had the keyword in a
 *     sidebar, not the article. Fast first-pass filter.
 *
 *   PHASE 2 (with resolved_url + HTTP fetch): for items whose Phase-1
 *     decision was negative BUT a Playwright resolver has populated
 *     resolved_url, fetch the actual publisher article and check if
 *     a kratom keyword appears in the EXTRACTED MAIN BODY (no nav,
 *     no aside, no related-stories). This rescues legitimate signal
 *     that Phase 1 dropped — e.g. news-roundup articles like
 *     "Magnolia Mornings: Feb 19" whose title doesn't mention kratom
 *     but whose body does.
 *
 * Sets news_items.body_has_kratom_keyword:
 *   - TRUE  → keyword found in title/summary OR in fetched body
 *   - FALSE → all available sources checked, no keyword anywhere
 *   - NULL  → couldn't decide (Phase 2 fetch failed, no resolved_url)
 *
 * Always sets body_verified_at so we don't re-check every cron run.
 *
 * Run:
 *   node --env-file=.env.local scripts/verify-news-body.mjs --limit 500
 *   node --env-file=.env.local scripts/verify-news-body.mjs --refresh
 *   node --env-file=.env.local scripts/verify-news-body.mjs --dry-run
 *   node --env-file=.env.local scripts/verify-news-body.mjs --phase 2
 *     (only re-process items that have a resolved_url and were Phase-1 flagged)
 */
import { createClient } from "@supabase/supabase-js";
import { hasKratomKeyword, extractArticleBody } from "./lib/kratom-keywords.mjs";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "500");
const REFRESH = args.includes("--refresh");
const DRY_RUN = args.includes("--dry-run");
const PHASE = parseInt(arg("--phase") ?? "0");  // 0 = both, 1 = title only, 2 = body only

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Safari/537.36";

async function fetchAndExtract(url) {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) throw new Error(`non-HTML: ${ct.slice(0, 40)}`);

  // Cap response at 1MB
  const reader = res.body.getReader();
  let received = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (received > 1_048_576) break;
  }
  const buf = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
  return extractArticleBody(html);
}

// ---------- Phase 1: title + summary keyword ----------
async function runPhase1() {
  let q = sb.from("news_items")
    .select("id, title, summary, state")
    .eq("active", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
  if (!REFRESH) q = q.is("body_verified_at", null);

  const { data: items, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  if (!items || items.length === 0) {
    console.log("Phase 1: nothing to verify.");
    return { kept: 0, flagged: 0 };
  }

  console.log(`Phase 1 (title+summary): ${items.length} items${DRY_RUN ? " [DRY]" : ""}…\n`);
  let kept = 0, flagged = 0;
  for (const it of items) {
    const hay = `${it.title ?? ""}\n${it.summary ?? ""}`;
    const decision = hasKratomKeyword(hay);
    if (decision) kept++; else flagged++;
    console.log(`  [${(it.state ?? "?").padEnd(3)}] ${decision ? "✓ keep" : "⚠ FP1"} ${(it.title ?? "").slice(0, 80)}`);
    if (!DRY_RUN) {
      await sb.from("news_items").update({
        body_verified_at: new Date().toISOString(),
        body_has_kratom_keyword: decision,
      }).eq("id", it.id);
    }
  }
  return { kept, flagged };
}

// ---------- Phase 2: body fetch via resolved_url ----------
async function runPhase2() {
  // Pull FP-flagged items WITH a resolved_url — these are Phase-1
  // negatives that we can now actually fact-check against the body.
  const { data: items, error } = await sb.from("news_items")
    .select("id, title, summary, state, resolved_url")
    .eq("active", true)
    .eq("body_has_kratom_keyword", false)
    .not("resolved_url", "is", null)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
  if (error) { console.error(error.message); return { rescued: 0, confirmed: 0, errored: 0 }; }
  if (!items || items.length === 0) {
    console.log("Phase 2: nothing to body-verify.");
    return { rescued: 0, confirmed: 0, errored: 0 };
  }

  console.log(`\nPhase 2 (body fetch): ${items.length} FP candidates with resolved URLs${DRY_RUN ? " [DRY]" : ""}…\n`);
  let rescued = 0, confirmed = 0, errored = 0;
  for (const it of items) {
    const tag = `[${(it.state ?? "?").padEnd(3)}] ${(it.title ?? "").slice(0, 65)}`;
    process.stdout.write(`  ${tag} `);
    try {
      const body = await fetchAndExtract(it.resolved_url);
      const hasKw = hasKratomKeyword(body);
      if (hasKw) {
        rescued++;
        console.log(`✓ rescued — kratom in body`);
        if (!DRY_RUN) {
          await sb.from("news_items").update({
            body_verified_at: new Date().toISOString(),
            body_has_kratom_keyword: true,
            body_extract_excerpt: body.slice(0, 500),
          }).eq("id", it.id);
        }
      } else {
        confirmed++;
        console.log(`⚠ confirmed FP — no kratom in body either`);
        if (!DRY_RUN) {
          await sb.from("news_items").update({
            body_verified_at: new Date().toISOString(),
            body_extract_excerpt: body.slice(0, 500),
          }).eq("id", it.id);
        }
      }
    } catch (e) {
      errored++;
      console.log(`✗ fetch: ${e.message?.slice(0, 40)}`);
      // Don't change Phase-1 decision on fetch failure — leave FP.
    }
    await sleep(1500);
  }
  return { rescued, confirmed, errored };
}

// ---------- main ----------
const t0 = Date.now();
let p1 = { kept: 0, flagged: 0 };
let p2 = { rescued: 0, confirmed: 0, errored: 0 };

if (PHASE === 0 || PHASE === 1) {
  p1 = await runPhase1();
}
if (PHASE === 0 || PHASE === 2) {
  p2 = await runPhase2();
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min`);
console.log(`Phase 1: kept=${p1.kept} FP-flagged=${p1.flagged}`);
console.log(`Phase 2: rescued=${p2.rescued} confirmed-FP=${p2.confirmed} errored=${p2.errored}`);

try {
  await sb.from("scraper_runs").insert({
    source: "verify_news_body",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: p1.kept + p1.flagged + p2.rescued + p2.confirmed,
    notes: `P1: kept=${p1.kept} FP=${p1.flagged} · P2: rescued=${p2.rescued} confirmed=${p2.confirmed} errored=${p2.errored}`,
  });
} catch { /* best-effort */ }

process.exit(0);
