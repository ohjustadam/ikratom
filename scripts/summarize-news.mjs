#!/usr/bin/env node
/**
 * summarize-news.mjs — generate a short, neutral AI summary for each kratom news
 * item so /news/[id] always shows OUR own synthesis (copyright-safe), even when
 * raw body extraction fails on JS-heavy sources (MSN, Yahoo, aggregators). 2-3
 * plain factual sentences, no opinion. Free-tier AI router; circuit-broken.
 *
 * Pairs with extract-news-content.mjs (fair-use excerpt + media): the summary is
 * the always-present layer; the excerpt/media fill in when extraction succeeds.
 *
 *   node --env-file=.env.local scripts/summarize-news.mjs
 *   node --env-file=.env.local scripts/summarize-news.mjs --limit 80 --days 30
 *   node --env-file=.env.local scripts/summarize-news.mjs --refresh --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";
import { makeFailGuard } from "./lib/batch-guard.mjs";
import { getFederalSchedulingFacts, groundingBlock, findFalseClaims, enforceFederalTruth } from "./lib/federal-scheduling.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const LIMIT = parseInt(arg("--limit") ?? "60", 10);
const DAYS = parseInt(arg("--days") ?? "21", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const guard = makeFailGuard();
const t0 = Date.now();

const SYS_BASE =
  "You are a neutral news editor for a nonpartisan kratom-policy platform. In 2-3 plain, " +
  "factual sentences, summarize the article for a reader who hasn't seen it: what happened, " +
  "where, and why it matters for kratom or 7-OH policy. No opinion, no hype, no first person. " +
  'Return ONLY JSON: {"summary": "..."}.';

// Ground the model in the real Federal Register record before it restates a
// newsroom's scheduling claim as fact (see lib/federal-scheduling.mjs for the
// 2026-08-28 incident this prevents). Degrades to the ungrounded prompt if the
// lookup fails — never blocks the batch.
const federalFacts = await getFederalSchedulingFacts();
if (!federalFacts.ok) console.log(`⚠ federal grounding unavailable: ${federalFacts.error}`);
const SYS = [SYS_BASE, groundingBlock(federalFacts)].filter(Boolean).join("\n\n");

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
let q = sb.from("news_items")
  .select("id, title, source_name, state, body_paragraphs, body_extract_excerpt")
  .eq("active", true)
  .not("body_has_kratom_keyword", "is", false)
  .not("policy_classified_at", "is", null)
  .gte("scraped_at", since)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("summary", null);
const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
console.log(`Providers: ${listAvailableProviders().join(", ")}`);
console.log(`${items.length} article(s) to summarize${DRY ? " [DRY]" : ""}`);

let done = 0, failed = 0;
for (const it of items) {
  const body = Array.isArray(it.body_paragraphs) && it.body_paragraphs.length
    ? it.body_paragraphs.join("\n\n").slice(0, 4000)
    : (it.body_extract_excerpt || "").slice(0, 4000);
  const loc = it.state ? `\nState: ${it.state}` : "";
  const user = body
    ? `Title: ${it.title}\nSource: ${it.source_name || "?"}${loc}\n\nArticle:\n${body}`
    : `Only the headline is available (full text could not be fetched). Summarize what it is about, factually, framing it as based on the headline.\n\nHeadline: ${it.title}\nSource: ${it.source_name || "?"}${loc}`;

  let summary;
  try {
    const r = await aiRouter({ systemPrompt: SYS, userPrompt: user, maxTokens: 300 });
    summary = (r.parsed?.summary ?? r.parsed?.Summary)?.toString().trim();
    guard.ok();
  } catch (e) {
    console.log(`  ✗ ${it.id.slice(0, 8)} ${String(e.message ?? e).slice(0, 50)}`);
    failed++;
    if (guard.fail(e)) { console.log("  circuit breaker — stopping early"); break; }
    continue;
  }
  if (!summary) { console.log(`  ∅ ${it.id.slice(0, 8)} empty`); failed++; continue; }

  // Publish gate. Grounding makes a false scheduling claim unlikely, not
  // impossible — the model still sees a source asserting it. Give it one
  // corrective retry, then fall back to leading with the verified record.
  if (findFalseClaims(summary, federalFacts).length) {
    console.log(`  ↻ ${it.id.slice(0, 8)} false federal claim — regenerating`);
    try {
      const retry = await aiRouter({
        systemPrompt: SYS,
        userPrompt: `${user}\n\nYour previous draft asserted a federal scheduling that the verified list contradicts. Rewrite it: describe what the article claims WITHOUT stating it as established fact, and name the discrepancy.`,
        maxTokens: 300,
      });
      const retried = (retry.parsed?.summary ?? retry.parsed?.Summary)?.toString().trim();
      if (retried) summary = retried;
    } catch { /* keep the first draft; the gate below still protects us */ }
  }
  const gated = enforceFederalTruth(summary, federalFacts);
  if (gated.corrected) console.log(`  ⚠ ${it.id.slice(0, 8)} prefixed correction (model kept the false claim)`);
  summary = gated.text.slice(0, 1200);
  console.log(`  ${it.id.slice(0, 8)} ${summary.slice(0, 66)}…`);
  if (DRY) { done++; continue; }
  const { error: upErr } = await sb.from("news_items").update({ summary }).eq("id", it.id);
  if (upErr) { console.log(`     ⚠ ${upErr.message?.slice(0, 60)}`); failed++; continue; }
  done++;
  await new Promise((r) => setTimeout(r, 150));
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — summarized ${done}, failed ${failed}`);
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "summarize_news",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: guard.status(done),
      rows_updated: done,
      error_message: guard.note(),
      notes: `summarized ${done} failed ${failed}`,
    });
  } catch { /* best-effort */ }
}
