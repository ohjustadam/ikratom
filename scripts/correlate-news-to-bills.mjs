#!/usr/bin/env node
/**
 * Backfill / refresh news_items.bill_id from three sources:
 *
 *   1. policy_alerts linkage: when news_items.policy_alert_id is set
 *      AND that policy_alert has a bill_id, copy it directly.
 *
 *   2. Bill-number regex on title + summary: extract bill numbers like
 *      "SB 154", "HB 1077", "H.B. 283", "AB 322", "LD 1546" and match
 *      against bills.bill_number where bills.state = news_items.state.
 *      Requires state match to avoid spurious cross-state matches —
 *      "SB 154" exists in every state's session.
 *
 *   3. AI semantic match (--ai flag): for rows where stage 1 + 2 failed
 *      and the news_item has kratom signal + a state, pass the title +
 *      summary + the state's active kratom bills to the AI router and
 *      ask which bill (if any) is being covered. Routes through Groq /
 *      Gemini / Cerebras / Mistral free tiers; ~$0 per call. Skips rows
 *      with bill_ai_correlation_attempted_at already set.
 *
 * Idempotent. Stages 1+2 set bill_correlation_attempted_at on every
 * processed row. Stage 3 sets bill_ai_correlation_attempted_at on every
 * processed row (separate column so its gating is independent of the
 * regex pass — see migration 0150). Use --refresh to ignore both.
 *
 * Usage:
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --ai
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --ai --limit 100
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --refresh
 *   node --env-file=.env.local scripts/correlate-news-to-bills.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { aiRouter, listAvailableProviders } from "./lib/ai-router.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const REFRESH = args.includes("--refresh");
const RUN_AI = args.includes("--ai");
const LIMIT = parseInt(args[args.indexOf("--limit") + 1] ?? "5000", 10);
// AI-stage limit is tighter — Gemini grounding has a 1,500/day cap on
// free tier and we want to leave headroom for other intel jobs. Default
// 100 per run × 24 hourly runs = 2,400/day, slightly over the cap — but
// the cron rate-limit logic in the AI router handles overrun gracefully
// by routing to other providers. Override with --ai-limit.
const AI_LIMIT = parseInt(args[args.indexOf("--ai-limit") + 1] ?? "100", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// =============================================================
// Bill-number regex. Matches common chamber+number patterns:
//   SB 154, S.B. 154, S 154, S-154, S154, SB154
//   HB 1077, H.B. 1077, H 1077, H-1077, etc.
//   AB 322 (CA assembly), AR (AR resolutions), LD (ME bills)
//   HR, HJR, SR, SJR, HCR, SCR, SJM, HJM (joint resolutions)
//   SF / HF (MN/IA files)
//
// We extract a normalized "PREFIX NUM" form e.g. "SB 154", "HB 1077",
// which matches our bills.bill_number conventions. We strip dashes and
// periods then re-add a single space.
// =============================================================
const BILL_NUMBER_RE =
  /\b(S\.?B\.?|H\.?B\.?|A\.?B\.?|H\.?R\.?|S\.?R\.?|H\.?J\.?R\.?|S\.?J\.?R\.?|H\.?C\.?R\.?|S\.?C\.?R\.?|S\.?J\.?M\.?|H\.?J\.?M\.?|S\.?F\.?|H\.?F\.?|L\.?D\.?|L\.?C\.?|A|H|S)[\s.\-]*(\d{1,5})\b/gi;

function extractBillNumbers(text) {
  if (!text) return [];
  const out = new Set();
  let m;
  // Reset regex state because BILL_NUMBER_RE is global
  BILL_NUMBER_RE.lastIndex = 0;
  while ((m = BILL_NUMBER_RE.exec(text)) !== null) {
    const prefix = m[1].replace(/[.\s\-]/g, "").toUpperCase();
    const num = m[2];
    if (num.length < 1 || num.length > 5) continue;
    // Bare single-letter prefix ("A", "H", "S") is the trickiest case:
    // it can match unrelated phrases ("S 1 building", "A 240 device").
    // We still emit it but it must hit BOTH the state-scope AND the
    // bills lookup to count — those constraints filter false positives
    // because most random "S 154"-looking strings won't be a bill in
    // the article's state.
    out.add(`${prefix} ${num}`);
  }
  return [...out];
}

// Some states use specific suffixes — normalize before comparing.
// e.g. LegiScan returns "S 154" while OpenStates returns "SB 154".
// We just check for either form in the candidate bills.
function billNumberVariants(canon) {
  const [pref, num] = canon.split(" ");
  const out = new Set([canon]);
  // Strip a trailing B from SB/HB/AB to handle "S 154" vs "SB 154"
  if (pref.endsWith("B")) out.add(`${pref.slice(0, -1)} ${num}`);
  if (pref.length === 1) out.add(`${pref}B ${num}`);
  return [...out];
}

const t0 = Date.now();

// =============================================================
// Stage 1: copy bill_id from policy_alerts
// =============================================================
console.log("Stage 1: copying bill_id from policy_alerts…");
let stage1 = 0;
{
  // Alert-driven: pull all alerts that HAVE a bill_id first, then
  // find news_items linked to those alerts. Inverting from news-first
  // ensures we pick up every linked news_item even if it's outside
  // a single LIMIT batch.
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("id, bill_id")
    .not("bill_id", "is", null);
  const alertToBill = new Map((alerts ?? []).map((a) => [a.id, a.bill_id]));
  console.log(`  ${alertToBill.size} policy_alerts have bill_id`);

  if (alertToBill.size > 0) {
    const { data: rows } = await sb
      .from("news_items")
      .select("id, policy_alert_id")
      .in("policy_alert_id", [...alertToBill.keys()])
      .is("bill_id", null);
    console.log(`  ${rows?.length ?? 0} news_items linked to those alerts but missing bill_id`);

    const toUpdate = (rows ?? [])
      .map((r) => ({ id: r.id, bill_id: alertToBill.get(r.policy_alert_id) }))
      .filter((r) => r.bill_id);

    if (!DRY_RUN) {
      for (const u of toUpdate) {
        await sb.from("news_items")
          .update({ bill_id: u.bill_id, bill_correlation_attempted_at: new Date().toISOString() })
          .eq("id", u.id);
      }
    }
    stage1 = toUpdate.length;
  }
  console.log(`  linked ${stage1} via policy_alerts`);
}

// =============================================================
// Stage 2: regex match titles/summaries → bill_number + state
// =============================================================
console.log("\nStage 2: bill-number regex match against title+summary…");
let stage2 = 0;
let stage2_attempted = 0;
let stage2_multi = 0;
{
  let q = sb
    .from("news_items")
    .select("id, state, title, summary")
    .eq("active", true)
    .is("bill_id", null)
    .not("state", "is", null);
  if (!REFRESH) q = q.is("bill_correlation_attempted_at", null);
  q = q.order("published_at", { ascending: false }).limit(LIMIT);
  const { data: rows } = await q;

  if (rows && rows.length > 0) {
    // Pre-load all kratom-relevant bills indexed by state+bill_number for
    // fast lookup. The bills table is small (~1000 rows) so we can hold
    // it all in memory.
    const { data: bills } = await sb
      .from("bills")
      .select("id, state, bill_number")
      .eq("active", true);

    const byKey = new Map(); // "STATE:BILLNUM" → id
    for (const b of bills ?? []) {
      if (!b.state || !b.bill_number) continue;
      // Normalize bill_number to "PREF NUM" with a single space, uppercase
      const normalized = String(b.bill_number).toUpperCase().replace(/[.\s\-]+/g, " ").replace(/\s+/g, " ").trim();
      byKey.set(`${b.state.toUpperCase()}:${normalized}`, b.id);
    }
    console.log(`  loaded ${byKey.size} bills for lookup`);

    const updates = [];
    for (const r of rows) {
      stage2_attempted++;
      const text = `${r.title ?? ""}\n${r.summary ?? ""}`;
      const found = extractBillNumbers(text);
      if (found.length === 0) {
        updates.push({ id: r.id, bill_id: null, reason: "no-bill-numbers-found" });
        continue;
      }
      // Try every extracted number + variant against this state
      const stateUC = r.state.toUpperCase();
      const matched = new Set();
      for (const canon of found) {
        for (const v of billNumberVariants(canon)) {
          const billId = byKey.get(`${stateUC}:${v}`);
          if (billId) matched.add(billId);
        }
      }
      if (matched.size === 0) {
        updates.push({ id: r.id, bill_id: null, reason: `no-state-match[${found.join(",")}]` });
      } else if (matched.size === 1) {
        updates.push({ id: r.id, bill_id: [...matched][0], reason: `single-match[${found.join(",")}]` });
      } else {
        // Multiple bills match — could be a news article covering
        // several related bills. Pick the first deterministically but
        // log it for review. (We don't yet have a many-to-many table.)
        stage2_multi++;
        updates.push({ id: r.id, bill_id: [...matched][0], reason: `multi-match[${matched.size}]` });
      }
    }

    if (!DRY_RUN) {
      for (const u of updates) {
        await sb.from("news_items")
          .update({
            bill_id: u.bill_id ?? null,
            bill_correlation_attempted_at: new Date().toISOString(),
          })
          .eq("id", u.id);
        if (u.bill_id) stage2++;
      }
    } else {
      stage2 = updates.filter((u) => u.bill_id).length;
    }
  }
  console.log(`  processed ${stage2_attempted}, linked ${stage2} (${stage2_multi} had multi-match)`);
}

// =============================================================
// Stage 3: AI semantic match (opt-in via --ai). For rows where stages
// 1+2 already failed (bill_correlation_attempted_at set, bill_id null),
// pass title+summary + the state's active kratom bills to the AI and
// ask which bill is being covered. Free-tier providers via aiRouter().
// =============================================================
let stage3 = 0;
let stage3_attempted = 0;
let stage3_no_candidates = 0;
let stage3_ai_says_none = 0;
if (RUN_AI) {
  console.log("\nStage 3: AI semantic match for remaining unlinked news…");
  const providers = listAvailableProviders();
  if (providers.length === 0) {
    console.log("  no AI providers available — skipping (set GROQ_API_KEY etc.)");
  } else {
    console.log(`  AI providers available: ${providers.join(", ")}`);

    // Eligible rows: stage 1+2 already tried, still no bill_id, has
    // kratom signal (body_has_kratom_keyword OR kratom-in-title), has
    // state, AI hasn't tried yet.
    let q = sb
      .from("news_items")
      .select("id, state, title, summary, body_has_kratom_keyword")
      .eq("active", true)
      .is("bill_id", null)
      .not("state", "is", null)
      .not("bill_correlation_attempted_at", "is", null);
    if (!REFRESH) q = q.is("bill_ai_correlation_attempted_at", null);
    q = q.order("published_at", { ascending: false }).limit(AI_LIMIT);
    const { data: rows } = await q;

    if (rows && rows.length > 0) {
      // Per-state active kratom bills lookup (active=true) — only the
      // anti/pro/needs_review ones, not neutrals.
      const states = [...new Set(rows.map((r) => r.state.toUpperCase()))];
      const { data: bills } = await sb
        .from("bills")
        .select("id, state, bill_number, title, kratom_relevance, status")
        .eq("active", true)
        .in("state", states)
        .in("kratom_relevance", ["anti", "pro", "needs_review"]);
      const billsByState = new Map();
      for (const b of bills ?? []) {
        const k = b.state.toUpperCase();
        if (!billsByState.has(k)) billsByState.set(k, []);
        billsByState.get(k).push(b);
      }
      console.log(`  ${rows.length} eligible rows, ${(bills ?? []).length} candidate bills across ${states.length} states`);

      const SYSTEM = `You match a news article to the specific state bill it covers.

INPUTS:
  - News article: title + summary + state
  - Candidate bills: a list of {id, bill_number, title, status} from the same state

TASK:
  Decide which candidate bill (if any) this news article is *primarily* about.
  - If the article describes a specific bill (by number, by sponsor's specific bill, by recent legislative action on a specific bill): return that bill's id
  - If the article is general kratom-policy news (FDA, science, court case, retailer profile, multiple bills equally) WITHOUT centering on one specific bill: return null
  - When in doubt, return null. False positives are worse than false negatives.

RESPONSE FORMAT (STRICT JSON):
  { "bill_id": "<uuid>" | null, "confidence": 0.0 - 1.0, "reasoning": "one short sentence" }`;

      for (const r of rows) {
        stage3_attempted++;
        const candidates = billsByState.get(r.state.toUpperCase()) ?? [];
        if (candidates.length === 0) {
          stage3_no_candidates++;
          if (!DRY_RUN) {
            await sb.from("news_items")
              .update({ bill_ai_correlation_attempted_at: new Date().toISOString() })
              .eq("id", r.id);
          }
          continue;
        }
        const candidatesBlock = candidates
          .slice(0, 30)
          .map((b) => `  - id=${b.id} bill=${b.bill_number} status=${b.status ?? "?"} title="${(b.title ?? "").slice(0, 140)}"`)
          .join("\n");
        const userPrompt = `STATE: ${r.state}\nARTICLE TITLE: ${r.title ?? ""}\nARTICLE SUMMARY: ${r.summary ?? ""}\n\nCANDIDATE BILLS (active anti/pro/review in this state):\n${candidatesBlock}\n\nReturn the JSON object only.`;

        let aiResult;
        try {
          const { provider, parsed } = await aiRouter({
            systemPrompt: SYSTEM,
            userPrompt,
            maxTokens: 400,
            verbose: false,
          });
          aiResult = { provider, parsed };
        } catch (e) {
          console.log(`    ⚠ ${r.id}: AI failed across providers: ${String(e.message).slice(0, 100)}`);
          // Don't set attempted_at — let next run retry
          continue;
        }

        const claimedId = aiResult.parsed?.bill_id;
        const confidence = Number(aiResult.parsed?.confidence ?? 0);
        const reasoning = String(aiResult.parsed?.reasoning ?? "").slice(0, 200);

        // Validate: claimed id must be in the candidates list
        const validClaim = candidates.find((b) => b.id === claimedId);

        if (!claimedId || !validClaim) {
          stage3_ai_says_none++;
          if (!DRY_RUN) {
            await sb.from("news_items")
              .update({ bill_ai_correlation_attempted_at: new Date().toISOString() })
              .eq("id", r.id);
          }
          continue;
        }

        // Require minimum confidence
        if (confidence < 0.6) {
          stage3_ai_says_none++;
          if (!DRY_RUN) {
            await sb.from("news_items")
              .update({ bill_ai_correlation_attempted_at: new Date().toISOString() })
              .eq("id", r.id);
          }
          continue;
        }

        if (!DRY_RUN) {
          await sb.from("news_items")
            .update({
              bill_id: claimedId,
              bill_ai_correlation_attempted_at: new Date().toISOString(),
            })
            .eq("id", r.id);
        }
        stage3++;
        console.log(`  ✓ ${r.state} ${validClaim.bill_number} via ${aiResult.provider} (conf=${confidence.toFixed(2)}): ${reasoning}`);
      }
    }
  }
  console.log(`  attempted ${stage3_attempted}, linked ${stage3}, no-candidates ${stage3_no_candidates}, AI-said-none ${stage3_ai_says_none}`);
}

const total = stage1 + stage2 + stage3;
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${total} total links${DRY_RUN ? " (DRY RUN)" : ""}.`);

try {
  await sb.from("scraper_runs").insert({
    source: "correlate_news_to_bills",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: total,
    notes: `stage1=${stage1}, stage2=${stage2} (of ${stage2_attempted} attempted, ${stage2_multi} multi), stage3=${stage3} (of ${stage3_attempted} attempted, ${stage3_no_candidates} no-candidates, ${stage3_ai_says_none} AI-said-none)`,
  });
} catch { /* best-effort */ }
