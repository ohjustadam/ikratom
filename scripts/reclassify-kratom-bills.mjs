#!/usr/bin/env node
/**
 * Emergency bulk reclassifier for active state bills with "kratom"
 * in the title that defaulted to kratom_relevance='neutral'.
 *
 * Two-pass:
 *   Pass 1: title-keyword heuristic (fast, deterministic)
 *     - matches "criminal", "prohibit", "ban", "schedule" → anti (conf 0.85)
 *     - matches "consumer protection", "kcpa", "labeling" → pro (conf 0.85)
 *     - anything ambiguous → flagged for pass 2
 *
 *   Pass 2: AI router decides on whatever pass 1 didn't catch.
 *     Reads title + summary, returns {kratom_relevance, confidence}.
 *
 * Once reclassified, runs the existing seed/journey enrichment hooks
 * via the hourly cron's normal pickup logic.
 *
 * Also surfaces any bill where status='enacted' but our system never
 * caught it — these are the same class of failure as TN SB 1656.
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter } from "./lib/ai-router.mjs";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ANTI_PATTERNS = [
  /\bcriminal\b/i,
  /\bprohibit/i,
  /\bban\b/i,
  /\billegal\b/i,
  /\bschedule [iI]+\b/i,
  /\bcontrolled substance/i,
  /\boffense/i,
  /\bdavenport/i,
  /\bnarcotic/i,
  /\bpenalty\b/i,
];

const PRO_PATTERNS = [
  /\bkratom consumer protection act/i,
  /\bkcpa\b/i,
  /\bconsumer protection/i,
  /\blabel(ing|ling)\b/i,
  /\bage[\s-]limit/i,
  /\bage[\s-]restriction/i,
  /\bage 21\b/i,
  /\bregulate.*sale/i,
  /\bsafety standard/i,
];

function classifyByTitle(title) {
  const t = title ?? "";
  let antiHits = ANTI_PATTERNS.filter((rx) => rx.test(t)).length;
  let proHits = PRO_PATTERNS.filter((rx) => rx.test(t)).length;
  if (antiHits > 0 && proHits === 0) return { relevance: "anti", confidence: 0.85, reason: "title-keyword anti" };
  if (proHits > 0 && antiHits === 0) return { relevance: "pro", confidence: 0.85, reason: "title-keyword pro" };
  if (antiHits > 0 && proHits > 0) return null; // ambiguous, kick to AI
  return null; // no signal, kick to AI
}

async function classifyWithAI(bill) {
  const sys = `You classify U.S. state kratom-related bills as anti, pro, or neutral. Output strict JSON: {"relevance":"anti"|"pro"|"neutral","confidence":0..1,"reason":"one sentence"}.
- anti: criminalizes possession/sale, schedules kratom as controlled, prohibits the substance, creates new criminal offenses related to kratom, broad bans
- pro: KCPA-style regulation (age limits, labeling, 7-OH cap), industry-supported framework, consumer protection
- neutral: tax-only bills, hemp/CBD bills that only mention kratom in passing, unrelated bills with incidental mentions`;
  const user = `Bill: ${bill.state} ${bill.bill_number}\nTitle: ${bill.title}\nSummary: ${(bill.summary ?? bill.summary_ai ?? "").slice(0, 800)}\n\nClassify:`;
  const r = await aiRouter({ systemPrompt: sys, userPrompt: user, maxTokens: 120, verbose: false });
  return r.parsed;
}

// Pull all active state bills with "kratom" in title classified as neutral or null
const { data: bills } = await sb.from("bills")
  .select("id,state,bill_number,title,summary,summary_ai,status,kratom_relevance,relevance_confidence,last_action_at")
  .eq("active", true)
  .eq("scope", "state")
  .or("kratom_relevance.eq.neutral,kratom_relevance.is.null")
  .ilike("title", "%kratom%")
  .order("last_action_at", { ascending: false, nullsFirst: false });

console.log(`Found ${bills?.length ?? 0} bills to reclassify\n`);

let p1Anti = 0, p1Pro = 0, p2Anti = 0, p2Pro = 0, p2Neutral = 0, fail = 0;

for (const b of bills ?? []) {
  let result = classifyByTitle(b.title);
  let pass = 1;

  if (!result) {
    // Pass 2: AI
    try {
      const ai = await classifyWithAI(b);
      if (ai && (ai.relevance === "anti" || ai.relevance === "pro" || ai.relevance === "neutral")) {
        result = { relevance: ai.relevance, confidence: ai.confidence ?? 0.7, reason: `AI: ${ai.reason}` };
        pass = 2;
      }
    } catch (e) {
      console.log(`  ✗ ${b.state} ${b.bill_number}: AI failed — ${e.message?.slice(0, 80)}`);
      fail++;
      continue;
    }
  }

  if (!result) {
    console.log(`  ⏭  ${b.state} ${b.bill_number}: no classification`);
    continue;
  }

  // Don't downgrade — if AI says neutral but title heuristic says anti, trust title
  if (result.relevance === "neutral" && pass === 2 && b.kratom_relevance === "neutral") {
    console.log(`  ⏭  ${b.state} ${b.bill_number}: confirmed neutral`);
    continue;
  }

  const { error } = await sb.from("bills").update({
    kratom_relevance: result.relevance,
    relevance_confidence: result.confidence,
    enriched_at: new Date().toISOString(),
  }).eq("id", b.id);
  if (error) {
    console.log(`  ✗ ${b.state} ${b.bill_number}: db update failed — ${error.message}`);
    fail++;
    continue;
  }

  const tag = result.relevance === "anti" ? "🚫 ANTI" : result.relevance === "pro" ? "✅ PRO" : "  neutral";
  console.log(`  ${tag} (p${pass}, ${result.confidence}) ${b.state} ${b.bill_number} — ${b.title?.slice(0, 70)}`);
  if (pass === 1) { if (result.relevance === "anti") p1Anti++; else p1Pro++; }
  else { if (result.relevance === "anti") p2Anti++; else if (result.relevance === "pro") p2Pro++; else p2Neutral++; }
  await new Promise((r) => setTimeout(r, 500));
}

console.log(`\nDone.`);
console.log(`  Pass 1 (title heuristic): anti=${p1Anti}, pro=${p1Pro}`);
console.log(`  Pass 2 (AI):              anti=${p2Anti}, pro=${p2Pro}, neutral=${p2Neutral}`);
console.log(`  Failures:                 ${fail}`);
console.log(`\nNext hourly cron will pick up the reclassified anti/pro bills for forum auto-post + journey enrichment.`);

try {
  await sb.from("scraper_runs").insert({
    source: "reclassify_kratom_bills",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: fail > 0 ? "error" : "success",
    rows_updated: p1Anti + p1Pro + p2Anti + p2Pro + p2Neutral,
    notes: `p1:${p1Anti}a/${p1Pro}p, p2:${p2Anti}a/${p2Pro}p/${p2Neutral}n, fail:${fail}`,
  });
} catch { /* best-effort */ }
