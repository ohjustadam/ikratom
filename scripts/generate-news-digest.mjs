#!/usr/bin/env node
/**
 * generate-news-digest.mjs — original, copyright-safe full write-up per news item.
 *
 * Owner ask (#19): iKratom links should BE the destination, not a bounce to the
 * source. summarize-news.mjs gives a 2-3 sentence teaser; this gives the full
 * read: 4-7 original plain-English paragraphs synthesized from the real source
 * text we already extracted (fair-use excerpt / verification snippet), so the
 * /news/[id] page reads complete in-app and the browser "Listen" has the whole
 * story to read — not just a headline.
 *
 * Copyright posture: the digest is OUR neutral synthesis, never the publisher's
 * text. We ONLY generate when real extracted source text exists (never from a
 * bare headline) so we never fabricate a story. We still link out to the source.
 *
 * Free-tier AI router (Groq/Gemini/Cerebras/…→Ollama); circuit-broken; $0.
 *
 *   node --env-file=.env.local scripts/generate-news-digest.mjs
 *   node --env-file=.env.local scripts/generate-news-digest.mjs --limit 80 --days 30
 *   node --env-file=.env.local scripts/generate-news-digest.mjs --refresh --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";
import { makeFailGuard } from "./lib/batch-guard.mjs";
import { getFederalSchedulingFacts, groundingBlock, findFalseClaims, correctionSentence } from "./lib/federal-scheduling.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const LIMIT = parseInt(arg("--limit") ?? "60", 10);
const DAYS = parseInt(arg("--days") ?? "21", 10);
const CONCURRENCY = parseInt(arg("--concurrency") ?? "1", 10);

// Minimum real source text (chars) before we'll synthesize a digest. Below
// this we'd be padding a headline into a fake article — skip it and let the
// extractor keep retrying instead. "Real data only."
const MIN_SOURCE_CHARS = 240;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const guard = makeFailGuard();
const t0 = Date.now();

const SYS_BASE =
  "You are a neutral news writer for a nonpartisan kratom-policy platform. Using ONLY the " +
  "source text provided, write an original plain-English digest of the article so a reader " +
  "fully understands it WITHOUT visiting the source. Rules: 4 to 7 short paragraphs; neutral " +
  "and factual, no opinion, no hype, no first person; do NOT invent facts, names, numbers, " +
  "dates, or quotes that are not in the source text; do not copy sentences verbatim — rewrite " +
  "in your own words. If the source text is too thin to support a full digest, return fewer " +
  'paragraphs rather than padding. Return ONLY JSON: {"paragraphs": ["...", "..."]}.';

// Ground the model in the real Federal Register record. The "use ONLY the source
// text" rule above exists so we never fabricate a story; the verified list below
// is the one authorized exception, and only for naming a contradiction — never
// for inventing narrative. See lib/federal-scheduling.mjs for the 2026-08-28
// incident this prevents. Degrades to the ungrounded prompt if the lookup fails.
const federalFacts = await getFederalSchedulingFacts();
if (!federalFacts.ok) console.log(`⚠ federal grounding unavailable: ${federalFacts.error}`);
const grounding = groundingBlock(federalFacts);
const SYS = grounding
  ? `${SYS_BASE}\n\n${grounding}\n\nThe verified list above is the ONLY information you may use that is not in the source text, and only to name a contradiction. Never use it to add facts the article does not discuss.`
  : SYS_BASE;

const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
let q = sb.from("news_items")
  .select("id, title, source_name, state, body_paragraphs, body_extract_excerpt")
  .eq("active", true)
  .not("body_has_kratom_keyword", "is", false)
  .not("policy_classified_at", "is", null)
  .gte("scraped_at", since)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(LIMIT);
if (!REFRESH) q = q.is("digest_generated_at", null);
const { data: items, error } = await q;
if (error) { console.error(error.message); process.exit(1); }
console.log(`Providers: ${listAvailableProviders().join(", ")}`);
console.log(`${items.length} candidate(s)${DRY ? " [DRY]" : ""} · concurrency ${CONCURRENCY}`);

let done = 0, failed = 0, skipped = 0;
let idx = 0, stop = false;

async function processItem(it) {
  const source = Array.isArray(it.body_paragraphs) && it.body_paragraphs.length
    ? it.body_paragraphs.join("\n\n")
    : (it.body_extract_excerpt || "");
  if (source.trim().length < MIN_SOURCE_CHARS) {
    skipped++;
    // Stamp digest_generated_at (paragraphs stay null) so this permanently-thin
    // item LEAVES the candidate pool. Under PostgREST's 1000-row fetch cap,
    // un-marked thin items pile up at the top of the newest-first window and
    // plug it — starving older digestable items (they never get fetched).
    // extract-news-content clears digest_generated_at whenever it writes a
    // fuller body, so genuine enrichment re-queues the item. We never fabricate
    // a digest from <240 chars of source ("real data only").
    if (!DRY) await sb.from("news_items").update({ digest_generated_at: new Date().toISOString() }).eq("id", it.id);
    return;
  }
  const loc = it.state ? `\nState: ${it.state}` : "";
  const user = `Title: ${it.title}\nSource: ${it.source_name || "?"}${loc}\n\nSource text:\n${source.slice(0, 6000)}`;

  let paragraphs, provider;
  try {
    const r = await aiRouter({ systemPrompt: SYS, userPrompt: user, maxTokens: 1400 });
    provider = r.provider;
    const raw = r.parsed?.paragraphs ?? r.parsed?.Paragraphs;
    paragraphs = Array.isArray(raw)
      ? raw.map((p) => String(p ?? "").trim()).filter((p) => p.length > 0)
      : [];
    guard.ok();
  } catch (e) {
    console.log(`  ✗ ${it.id.slice(0, 8)} ${String(e.message ?? e).slice(0, 50)}`);
    failed++;
    if (guard.fail(e)) { console.log("  circuit breaker — stopping early"); stop = true; }
    return;
  }

  // Cap: at most 8 paragraphs / ~4500 chars total — bounded + fair-use safe.
  const capped = [];
  let total = 0;
  for (const p of paragraphs) {
    if (capped.length > 0 && total + p.length > 4500) break;
    capped.push(p);
    total += p.length;
  }
  paragraphs = capped.slice(0, 8);

  // Publish gate — the digest is what the in-app "Listen" reads aloud, so a
  // false scheduling claim here is narrated to the user as fact. Never persist
  // one: lead with the verified record instead.
  if (findFalseClaims(paragraphs.join("\n"), federalFacts).length) {
    const today = new Date().toISOString().slice(0, 10);
    paragraphs = [
      `Correction, ${today}. ${correctionSentence(federalFacts)} The account below reflects the source article's reporting, which conflicts with the federal record on this point.`,
      ...paragraphs,
    ];
    console.log(`  ⚠ ${it.id.slice(0, 8)} false federal claim — prefixed correction`);
  }

  if (paragraphs.length === 0) { console.log(`  ∅ ${it.id.slice(0, 8)} empty`); failed++; return; }
  console.log(`  ${it.id.slice(0, 8)} → ${paragraphs.length}¶ via ${provider}`);
  if (DRY) { done++; return; }
  const { error: upErr } = await sb.from("news_items").update({
    digest_paragraphs: paragraphs,
    digest_generated_at: new Date().toISOString(),
  }).eq("id", it.id);
  if (upErr) { console.log(`     ⚠ ${upErr.message?.slice(0, 60)}`); failed++; return; }
  done++;
}

// Bounded-concurrency worker pool. Each 1400-token digest is latency-bound
// (~5-10s waiting on the model), and the free-tier router fails over across
// providers, so N concurrent calls give near-linear speedup until rate limits
// bite. --concurrency defaults to 1 so the nightly cron behavior is unchanged;
// the on-box backfill passes a higher value. idx++ is atomic (no await between
// read and increment) so workers never grab the same item.
async function worker() {
  while (!stop) {
    const i = idx++;
    if (i >= items.length) break;
    await processItem(items[i]);
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — digested ${done}, skipped ${skipped} (thin), failed ${failed}`);
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "generate_news_digest",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: guard.status(done),
      rows_updated: done,
      error_message: guard.note(),
      notes: `digested ${done} skipped ${skipped} failed ${failed}`,
    });
  } catch { /* best-effort */ }
}
