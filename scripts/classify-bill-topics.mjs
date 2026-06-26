#!/usr/bin/env node
/**
 * classify-bill-topics.mjs — phase-1 multi-topic foundation.
 *
 * Tags EXISTING bills with which substance-policy topics they touch, into the
 * additive bills.bill_topics jsonb (migration 0223). Keyword-only + the
 * authoritative kratom signal carried in from kratom_relevance — no AI, no
 * external API, so it's fast + free + collision-free (touches only bill_topics,
 * never kratom_relevance/status/sponsors that other sessions own).
 *
 * This does NOT discover new non-kratom bills (that's phase 2, which requires
 * making the app topic-aware so non-kratom bills don't pollute kratom surfaces).
 * It surfaces which already-tracked bills are multi-substance (e.g. a controlled-
 * substances omnibus that hits kratom AND cannabis) — real cross-topic intel +
 * the foundation phase 2 builds on.
 *
 * Honest by construction: keyword method is recorded ("method":"keyword") so a
 * later AI pass can refine; we never invent a stance we didn't detect.
 *
 *   node --env-file=.env.local scripts/classify-bill-topics.mjs --dry-run
 *   node --env-file=.env.local scripts/classify-bill-topics.mjs --state=OK
 *   node --env-file=.env.local scripts/classify-bill-topics.mjs --force --limit=200
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { TOPIC_KEYWORDS, matchedKeywords, coarseStance } from "./lib/bill-topic-keywords.mjs";

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
const log = (...a) => console.log(...a);

// kratom_relevance (curated) -> the bill_topics coarse vocabulary.
function kratomStance(rel) {
  if (rel === "anti") return "restrictive";
  if (rel === "pro") return "permissive";
  return "unknown";
}

const NON_KRATOM_TOPICS = Object.keys(TOPIC_KEYWORDS).filter((t) => t !== "kratom");

async function recentlyRan() {
  if (FORCE) return false;
  const { data } = await sb.from("scraper_runs").select("finished_at").eq("source", "bill_topics_classify").eq("status", "success").order("finished_at", { ascending: false }).limit(1);
  const last = data?.[0]?.finished_at;
  if (!last) return false;
  return (Date.now() - new Date(last).getTime()) / 86400000 < 6;
}

async function main() {
  if (await recentlyRan()) { log("bill_topics_classify ran <6d ago — skipping (use --force)."); return; }
  log(`bill-topics classify — ${DRY ? "DRY-RUN" : "LIVE"}${STATE ? ` state=${STATE}` : ""}${LIMIT ? ` limit=${LIMIT}` : ""}`);

  await runWithLogging({ source: "bill_topics_classify", supabase: sb }, async () => {
    // Full work-list, range-paginated past PostgREST's 1000-row cap.
    const PAGE = 1000;
    const bills = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from("bills").select("id, state, bill_number, title, summary, kratom_relevance").order("id").range(from, from + PAGE - 1);
      if (STATE) q = q.eq("state", STATE);
      const { data: page, error } = await q;
      if (error) throw new Error(`bills query: ${error.message}`);
      bills.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
      if (LIMIT && bills.length >= LIMIT) break;
    }
    if (LIMIT && bills.length > LIMIT) bills.length = LIMIT;
    log(`${bills.length} bills to classify.`);

    const now = new Date().toISOString();
    let updated = 0, crossTopic = 0, failed = 0;
    const topicTally = {};
    for (const b of bills) {
      const text = `${b.title ?? ""} ${b.summary ?? ""}`;
      const topics = {};
      // kratom from the curated relevance signal (these are kratom-discovered bills)
      topics.kratom = { stance: kratomStance(b.kratom_relevance), confidence: 0.9, method: "kratom_relevance", matched: [], at: now };
      // other topics by keyword
      let otherHits = 0;
      for (const topic of NON_KRATOM_TOPICS) {
        const matched = matchedKeywords(text, TOPIC_KEYWORDS[topic]);
        if (matched.length === 0) continue;
        topics[topic] = { stance: coarseStance(text), confidence: 0.5, method: "keyword", matched, at: now };
        otherHits++;
        topicTally[topic] = (topicTally[topic] ?? 0) + 1;
      }
      if (otherHits > 0) crossTopic++;
      if (!DRY) {
        const { error } = await sb.from("bills").update({ bill_topics: topics, bill_topics_classified_at: now }).eq("id", b.id);
        if (error) { log(`  ! ${b.state} ${b.bill_number}: ${error.message}`); failed++; continue; }
      }
      updated++;
    }
    log(`cross-topic bills (touch a non-kratom topic): ${crossTopic}`);
    log(`per-topic hits: ${JSON.stringify(topicTally)}`);
    const notes = `${DRY ? "dry-run " : ""}${updated} classified, ${crossTopic} cross-topic, ${failed} failed, of ${bills.length}`;
    log(`\n${notes}`);
    return { rowsAdded: 0, rowsUpdated: DRY ? 0 : updated, notes };
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
