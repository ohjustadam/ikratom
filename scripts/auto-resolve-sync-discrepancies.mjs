#!/usr/bin/env node
/**
 * Auto-resolve scraper_stale (sync discrepancy) policy_alerts by
 * cross-checking the AI claim against fresh LegiScan data.
 *
 * Background: verify-bill-status-ai.mjs runs daily and flags bills
 * where DB status disagrees with what Gemini-grounded search returns.
 * Those land as kind='scraper_stale' policy_alerts on
 * /admin/sync-discrepancies for manual triage.
 *
 * This script runs AFTER the verify step and tries to resolve them
 * automatically using LegiScan (the most authoritative source):
 *
 *   1. Parse alert body for the AI-claimed status
 *   2. Pull bill's CURRENT DB state (may have been updated since
 *      the alert was created)
 *   3. If DB now matches AI → resolve as "DB caught up"
 *   4. Else: pull fresh LegiScan data
 *        - If LegiScan matches DB → resolve as "AI was wrong"
 *          (DB stays as-is)
 *        - If LegiScan matches AI → update bill from LegiScan +
 *          resolve as "fix applied, LegiScan confirmed AI"
 *        - Inconclusive → leave open for admin
 *
 * Run:
 *   node --env-file=.env.local scripts/auto-resolve-sync-discrepancies.mjs
 *   node --env-file=.env.local scripts/auto-resolve-sync-discrepancies.mjs --dry-run
 *   node --env-file=.env.local scripts/auto-resolve-sync-discrepancies.mjs --limit 5
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const DRY_RUN = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "50", 10);

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LEGISCAN_KEY = process.env.LEGISCAN_API_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
// LegiScan is optional — without it we can still resolve the
// "DB caught up" case (most common). Cases requiring tie-break
// stay open for admin until LegiScan key is configured.
const HAS_LEGISCAN = !!LEGISCAN_KEY;
if (!HAS_LEGISCAN) {
  console.log("⚠ LEGISCAN_API_KEY not set — will only resolve 'DB caught up' cases. Cases needing LegiScan tie-break stay open.\n");
}

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Normalize status strings so semantically-equivalent labels match:
//   committee ↔ in_committee
//   passed   ↔ passed_chamber
//   signed   ↔ enacted
//   dead     ↔ failed
// Mirror of any DB-side normalization plus the AI's preferred labels
// from verify-bill-status-ai.mjs system prompt.
const STATUS_SYNONYMS = {
  committee: "in_committee",
  in_committee: "in_committee",
  refer_to_committee: "in_committee",
  introduced: "introduced",
  filed: "introduced",
  passed: "passed_chamber",
  passed_chamber: "passed_chamber",
  enacted: "enacted",
  signed: "enacted",
  approved: "enacted",
  law: "enacted",
  vetoed: "vetoed",
  dead: "dead",
  failed: "dead",
  died: "dead",
  withdrawn: "dead",
};
function normalizeStatus(s) {
  if (!s) return s;
  const lower = s.toLowerCase().trim().replace(/\s+/g, "_");
  return STATUS_SYNONYMS[lower] ?? lower;
}

// LegiScan status code → our status string (mirror of sync-bills-via-legiscan.mjs)
const LEGISCAN_STATUS_MAP = {
  1: "introduced",
  2: "in_committee",
  3: "in_committee",  // refer to committee
  4: "passed_chamber",
  5: "passed_chamber",
  6: "enacted",
  7: "vetoed",
  8: "enacted",       // override
  9: "dead",
  10: "dead",
};

async function legiscanFetch(op, params) {
  const u = new URL("https://api.legiscan.com/");
  u.searchParams.set("key", LEGISCAN_KEY);
  u.searchParams.set("op", op);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const r = await fetch(u.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`LegiScan ${op} ${r.status}`);
  const data = await r.json();
  if (data.status === "ERROR") throw new Error(`LegiScan ${op}: ${data.alert?.message ?? "unknown"}`);
  return data;
}

// Parse AI-claimed status from alert body (format produced by
// verify-bill-status-ai.mjs). Body looks like:
//   AI-grounded check (Gemini + live web search):
//     status: enacted
//     latest_action: ...
function parseAiStatusFromBody(body) {
  if (!body) return null;
  const m = body.match(/AI-grounded check[^\n]*\n\s*status:\s*(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

function parseAiActionFromBody(body) {
  if (!body) return null;
  const m = body.match(/AI-grounded check[\s\S]*?latest_action:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

async function resolveOne(alert) {
  console.log(`\n[${alert.id.slice(0, 8)}] ${alert.title.slice(0, 80)}`);
  if (!alert.bill_id) {
    console.log("  ⚠ no bill_id — skipping (admin must resolve manually)");
    return { status: "no-bill" };
  }

  // Pull current DB state
  const { data: bill } = await sb.from("bills")
    .select("id, state, bill_number, status, last_action, last_action_at, legiscan_bill_id")
    .eq("id", alert.bill_id)
    .maybeSingle();
  if (!bill) {
    console.log("  ⚠ bill no longer exists — resolving as stale-reference");
    if (!DRY_RUN) {
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: "Auto-resolved: linked bill no longer exists",
        moderated_at: new Date().toISOString(),
      }).eq("id", alert.id);
    }
    return { status: "auto-resolved", reason: "bill-deleted" };
  }

  const aiStatus = parseAiStatusFromBody(alert.body);
  const aiAction = parseAiActionFromBody(alert.body);
  if (!aiStatus) {
    console.log("  ⚠ could not parse AI status from body — skipping");
    return { status: "unparseable" };
  }

  const dbStatusNorm = normalizeStatus(bill.status);
  const aiStatusNorm = normalizeStatus(aiStatus);
  console.log(`  DB: ${bill.status} (→${dbStatusNorm})  AI: ${aiStatus} (→${aiStatusNorm})  Action: "${(aiAction ?? "").slice(0, 50)}"`);

  // CASE 1: DB matches AI after normalization (e.g. "committee" == "in_committee")
  if (dbStatusNorm === aiStatusNorm) {
    const wasSynonym = bill.status?.toLowerCase() !== aiStatus.toLowerCase();
    const reason = wasSynonym ? `Status synonyms (${bill.status} == ${aiStatus})` : `DB matches AI (${aiStatus})`;
    console.log(`  ✓ ${reason} — auto-resolving`);
    if (!DRY_RUN) {
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: `Auto-resolved: ${reason}. No real discrepancy.`,
        moderated_at: new Date().toISOString(),
      }).eq("id", alert.id);
    }
    return { status: "auto-resolved", reason: wasSynonym ? "synonym-match" : "db-caught-up" };
  }

  // CASE 1.5: Keyword tie-break from last_action text. Owner directive
  // 2026-05-14: 'you should always audit and fix these before they reach
  // me.' When DB and AI disagree, the bill's own last_action text often
  // contains an unambiguous signal: "Approved by the Governor", "Chapter
  // 429", "Session Sine Die", "Died", "Placed in Legislative Files".
  // Trust those over either the DB status (which may be stale) or the AI
  // claim (which may be wrong).
  const lastAction = bill.last_action ?? "";
  const lastActionAt = bill.last_action_at ? new Date(bill.last_action_at) : null;
  const ageDays = lastActionAt ? Math.floor((Date.now() - lastActionAt.getTime()) / 86_400_000) : null;
  const ENACTED_PATTERNS = [
    /approved by the governor/i, /signed by (the )?governor/i, /became law/i,
    /\bchapter\s+\d+\b/i, /effective date/i, /^enacted\b/i,
  ];
  const DEAD_PATTERNS = [
    /session sine die/i, /\bdied\b/i, /indefinitely postponed/i,
    /\bwithdrawn\b/i, /placed in legislative files/i, /\bvetoed\b/i,
  ];
  let keywordStatus = null;
  let keywordReason = "";
  if (aiStatusNorm === "enacted" && ENACTED_PATTERNS.some((re) => re.test(lastAction))) {
    keywordStatus = "enacted";
    keywordReason = `last_action "${lastAction.slice(0, 60)}" matches enacted pattern + AI agrees`;
  } else if (aiStatusNorm === "dead" && DEAD_PATTERNS.some((re) => re.test(lastAction))) {
    keywordStatus = "dead";
    keywordReason = `last_action "${lastAction.slice(0, 60)}" matches dead pattern + AI agrees`;
  } else if (aiStatusNorm === "dead" && ageDays != null && ageDays >= 730) {
    // 2+ year old with AI saying dead — almost certainly from a closed session
    keywordStatus = "dead";
    keywordReason = `last_action_at is ${ageDays}d old (>= 2yr threshold) + AI confirms dead`;
  }
  if (keywordStatus) {
    console.log(`  ✓ keyword tie-break: ${bill.status} → ${keywordStatus} (${keywordReason})`);
    if (!DRY_RUN) {
      if (bill.status !== keywordStatus) {
        await sb.from("bills").update({ status: keywordStatus }).eq("id", bill.id);
      }
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: `Auto-resolved via keyword tie-break: ${keywordReason}`,
        moderated_at: new Date().toISOString(),
      }).eq("id", alert.id);
    }
    return { status: "auto-resolved", reason: "keyword-tiebreak" };
  }

  // Skip the LegiScan tie-break if we don't have a key — those alerts
  // stay open for manual admin review.
  if (!HAS_LEGISCAN) {
    console.log("  ⏭  DB ≠ AI, no keyword signal, LegiScan disabled — leaving open for admin");
    return { status: "no-legiscan-match" };
  }

  // CASE 2: Pull fresh LegiScan to tie-break
  let legiscanId = bill.legiscan_bill_id;
  if (!legiscanId) {
    // Search for it
    try {
      const compact = bill.bill_number.replace(/\s+/g, "");
      const data = await legiscanFetch("getSearch", { state: bill.state, query: compact });
      const results = data.searchresult ?? {};
      for (const key of Object.keys(results)) {
        if (key === "summary") continue;
        const r = results[key];
        if (r.bill_number && r.bill_number.replace(/\s+/g, "") === compact) {
          legiscanId = r.bill_id;
          break;
        }
      }
    } catch (e) {
      console.log(`  ✗ LegiScan search failed: ${e.message?.slice(0, 80)}`);
      return { status: "legiscan-error" };
    }
    if (!legiscanId) {
      console.log("  ⚠ LegiScan has no match — can't tie-break; leaving open");
      return { status: "no-legiscan-match" };
    }
  }
  await sleep(500);   // polite between LegiScan calls

  let legiscanBill;
  try {
    const data = await legiscanFetch("getBill", { id: String(legiscanId) });
    legiscanBill = data.bill ?? null;
  } catch (e) {
    console.log(`  ✗ LegiScan getBill failed: ${e.message?.slice(0, 80)}`);
    return { status: "legiscan-error" };
  }
  if (!legiscanBill) {
    console.log("  ⚠ LegiScan returned no bill data; leaving open");
    return { status: "no-legiscan-data" };
  }

  const legiscanStatus = LEGISCAN_STATUS_MAP[legiscanBill.status];
  console.log(`  LegiScan: ${legiscanStatus ?? "(unknown code " + legiscanBill.status + ")"}`);

  // CASE 3: LegiScan matches DB → AI was wrong
  if (legiscanStatus === dbStatus) {
    console.log("  ✓ LegiScan confirms DB — AI was wrong, auto-resolving");
    if (!DRY_RUN) {
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: `Auto-resolved: LegiScan confirms DB status (${dbStatus}). AI claim of "${aiStatus}" was wrong.`,
        moderated_at: new Date().toISOString(),
      }).eq("id", alert.id);
    }
    return { status: "auto-resolved", reason: "ai-wrong" };
  }

  // CASE 4: LegiScan matches AI → DB was stale, update DB + resolve
  if (legiscanStatus === aiStatus) {
    console.log("  ✓ LegiScan confirms AI — updating bill from LegiScan + auto-resolving");
    if (!DRY_RUN) {
      // Find the most recent action from LegiScan
      const lastAction = (legiscanBill.history ?? []).slice(-1)[0];
      const lastActionDate = lastAction?.date ?? null;
      const lastActionText = lastAction?.action ?? aiAction ?? null;
      await sb.from("bills").update({
        status: aiStatus,
        last_action: lastActionText?.slice(0, 500),
        last_action_at: lastActionDate,
        legiscan_bill_id: legiscanId,
        last_synced_at: new Date().toISOString(),
      }).eq("id", bill.id);
      await sb.from("policy_alerts").update({
        moderation_status: "rejected",
        moderation_note: `Auto-resolved: LegiScan confirms AI (${aiStatus}). Bill updated from LegiScan data.`,
        moderated_at: new Date().toISOString(),
      }).eq("id", alert.id);
    }
    return { status: "auto-resolved", reason: "ai-right-bill-fixed" };
  }

  // CASE 5: All three disagree — leave for admin
  console.log("  ? Three-way disagreement (DB / AI / LegiScan all differ); leaving open");
  return { status: "three-way-disagree" };
}

// ---------- main ----------
console.log(`Auto-resolve sync discrepancies${DRY_RUN ? " [DRY RUN]" : ""}…\n`);

const { data: open, error } = await sb.from("policy_alerts")
  .select("id, title, body, bill_id")
  .eq("kind", "scraper_stale")
  .eq("moderation_status", "approved")
  .order("created_at", { ascending: false })
  .limit(LIMIT);

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}
console.log(`${open.length} open discrepanc${open.length === 1 ? "y" : "ies"} to process`);

const t0 = Date.now();
const counts = {
  "auto-resolved": 0,
  "db-caught-up": 0,
  "keyword-tiebreak": 0,
  "ai-wrong": 0,
  "ai-right-bill-fixed": 0,
  "bill-deleted": 0,
  "synonym-match": 0,
  "three-way-disagree": 0,
  "no-bill": 0,
  "no-legiscan-match": 0,
  "no-legiscan-data": 0,
  "legiscan-error": 0,
  "unparseable": 0,
};

for (const a of open) {
  try {
    const r = await resolveOne(a);
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (r.reason) counts[r.reason] = (counts[r.reason] ?? 0) + 1;
  } catch (e) {
    console.log(`  ✗ unexpected error: ${e.message?.slice(0, 100)}`);
  }
  await sleep(1000);  // polite pace to LegiScan
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\n========== Done in ${elapsed} min ==========`);
console.log(`Auto-resolved: ${counts["auto-resolved"]} of ${open.length}`);
console.log(`  · DB caught up:         ${counts["db-caught-up"]}`);
console.log(`  · Keyword tie-break:    ${counts["keyword-tiebreak"]}`);
console.log(`  · AI was wrong:         ${counts["ai-wrong"]}`);
console.log(`  · AI right, bill fixed: ${counts["ai-right-bill-fixed"]}`);
console.log(`  · Bill deleted:         ${counts["bill-deleted"]}`);
console.log(`Left open for admin:`);
console.log(`  · Three-way disagree:   ${counts["three-way-disagree"]}`);
console.log(`  · No bill linked:       ${counts["no-bill"]}`);
console.log(`  · LegiScan errors:      ${counts["no-legiscan-match"] + counts["no-legiscan-data"] + counts["legiscan-error"]}`);
console.log(`  · Unparseable body:     ${counts["unparseable"]}`);

try {
  await sb.from("scraper_runs").insert({
    source: "auto_resolve_sync_discrepancies",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: counts["auto-resolved"] > 0 ? "success" : "empty",
    rows_added: counts["auto-resolved"],
    notes: `${open.length} open · ${counts["auto-resolved"]} resolved (${counts["db-caught-up"]} db caught up, ${counts["ai-wrong"]} ai wrong, ${counts["ai-right-bill-fixed"]} ai right) · ${counts["three-way-disagree"]} 3-way disagree`,
  });
} catch { /* */ }
process.exit(0);
