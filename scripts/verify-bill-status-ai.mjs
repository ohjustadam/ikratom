#!/usr/bin/env node
/**
 * Layer 3 of the real-time pipeline: AI-grounded verification.
 *
 * For each active anti/pro state bill, ask Gemini-with-Search to
 * report the CURRENT status using live web data. Compare to our
 * DB. Discrepancies become 'scraper_stale' policy_alerts that
 * surface on /admin/intel-health for an admin to triage.
 *
 * This is the safety net for cases where BOTH OpenStates and
 * LegiScan miss something (the TN SB 1656 scenario where
 * companion HB 1649 actually passed but OpenStates only tracked
 * SB 1656's frozen state).
 *
 * Free-tier cost: Gemini 1500 req/day. Run daily on ~50 tracked
 * bills = 50 calls/day. Well within quota.
 *
 * Run:
 *   node --env-file=.env.local scripts/verify-bill-status-ai.mjs --all
 *   node --env-file=.env.local scripts/verify-bill-status-ai.mjs --bill <uuid>
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error("GEMINI_API_KEY required"); process.exit(1); }

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const SPECIFIC = arg("--bill");
const ALL = args.includes("--all");

if (!SPECIFIC && !ALL) {
  console.error("Usage: --all | --bill <uuid>");
  process.exit(1);
}

const SYS = `You are a legislative-status fact-checker. Given a US state bill, use Google Search to find its CURRENT status as of today. Return STRICT JSON inside <result>...</result>:

<result>
{
  "found": true|false,
  "status": "introduced" | "in_committee" | "passed_chamber" | "enacted" | "vetoed" | "dead",
  "latest_action": "single sentence — most recent meaningful action",
  "latest_action_date": "YYYY-MM-DD" or null,
  "signed_into_law": true|false,
  "signed_date": "YYYY-MM-DD" or null,
  "companion_bill": "HB1234 or null — if the companion bill is the one that passed",
  "sources": ["url1", "url2"]
}
</result>

Rules:
- Prefer .gov / state-capitol URLs (capitol.tn.gov, leginfo.legislature.ca.gov, etc.) over news aggregators.
- If a companion bill (House version of a Senate bill or vice versa) was substituted and that's the version that moved/passed, note it.
- "enacted" = signed by Governor. "passed_chamber" = passed one chamber but not yet the other. "dead" = died in committee, withdrawn, vetoed without override.
- If you can't find verifiable info, return found=false with sources listing what you tried.
- Output ONLY the <result> block, no prose.`;

async function verifyBill(bill) {
  const userPrompt = `State: ${bill.state}\nBill number: ${bill.bill_number}\nOur DB shows: status=${bill.status}, last_action="${bill.last_action ?? '(none)'}" on ${bill.last_action_at ?? '?'}\nTitle: ${(bill.title ?? '').slice(0, 200)}\n\nWhat is the CURRENT status of this bill as of today?`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: SYS }] },
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  const m = text.match(/<result>([\s\S]*?)<\/result>/);
  if (!m) throw new Error(`No <result> block in response: ${text.slice(0, 200)}`);
  return JSON.parse(m[1]);
}

function statusMatches(dbStatus, aiStatus) {
  if (dbStatus === aiStatus) return true;
  // Accept "in_committee" vs "introduced" as fuzzy-equal early-stage
  const earlyStage = new Set(["introduced", "in_committee"]);
  if (earlyStage.has(dbStatus) && earlyStage.has(aiStatus)) return true;
  return false;
}

async function flagDiscrepancy(bill, ai) {
  const title = `Sync discrepancy: ${bill.state} ${bill.bill_number} — DB says ${bill.status}, AI says ${ai.status}`;
  const body = [
    `Bill: ${bill.state} ${bill.bill_number}`,
    `Title: ${bill.title ?? '(none)'}`,
    ``,
    `DB state:`,
    `  status: ${bill.status}`,
    `  last_action: ${bill.last_action ?? '(none)'}`,
    `  last_action_at: ${bill.last_action_at ?? '?'}`,
    ``,
    `AI-grounded check (Gemini + live web search):`,
    `  status: ${ai.status}`,
    `  latest_action: ${ai.latest_action ?? '(none)'}`,
    `  latest_action_date: ${ai.latest_action_date ?? '?'}`,
    `  signed_into_law: ${ai.signed_into_law ?? false}`,
    `  signed_date: ${ai.signed_date ?? '?'}`,
    `  companion_bill: ${ai.companion_bill ?? '(none)'}`,
    ``,
    `Sources checked: ${(ai.sources ?? []).slice(0, 3).join(', ') ?? '(none)'}`,
    ``,
    `→ Admin should triage on /admin/intel-health and force-sync if needed.`,
  ].join("\n");

  const { data } = await sb.from("policy_alerts").insert({
    kind: "scraper_stale",
    severity: ai.signed_into_law ? "critical" : "alert",
    title: title.slice(0, 200),
    body,
    locality: bill.state ?? "ALL",
    bill_id: bill.id,
    action_required: false,
    moderation_status: "approved",
  }).select("id").single();

  // Update the bill's last_synced_at + add a stamp so we don't re-fire
  // the same discrepancy every day
  await sb.from("bills").update({
    last_synced_at: new Date().toISOString(),
  }).eq("id", bill.id);

  return data?.id;
}

// ---- main ----
let bills;
if (SPECIFIC) {
  const { data } = await sb.from("bills")
    .select("id, state, bill_number, title, status, last_action, last_action_at, kratom_relevance")
    .eq("id", SPECIFIC).single();
  bills = data ? [data] : [];
} else {
  const { data } = await sb.from("bills")
    .select("id, state, bill_number, title, status, last_action, last_action_at, kratom_relevance")
    .eq("active", true)
    .eq("scope", "state")
    .in("kratom_relevance", ["anti", "pro"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);
  bills = data ?? [];
}

if (bills.length === 0) { console.log("Nothing to verify."); process.exit(0); }
console.log(`Verifying ${bills.length} bill(s) via Gemini Search grounding…`);

let ok = 0, fail = 0, discrepancies = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const b of bills) {
  console.log(`\n=== ${b.state} ${b.bill_number} | rel:${b.kratom_relevance} | DB:${b.status} ===`);
  try {
    const ai = await verifyBill(b);
    if (!ai.found) {
      console.log(`  ⏭  AI: not found — sources: ${(ai.sources ?? []).slice(0, 2).join(', ')}`);
      ok++;
      continue;
    }
    console.log(`  AI status: ${ai.status} | latest: ${(ai.latest_action ?? '?').slice(0, 60)} (${ai.latest_action_date ?? '?'})`);
    if (statusMatches(b.status, ai.status)) {
      console.log(`  ✓ in sync`);
    } else {
      const alertId = await flagDiscrepancy(b, ai);
      console.log(`  🚨 DISCREPANCY → policy_alert ${alertId?.slice(0, 8)}`);
      discrepancies++;
    }
    ok++;
  } catch (e) {
    console.log(`  ✗ ${e.message?.slice(0, 120)}`);
    fail++;
  }
  await sleep(2000); // polite to Gemini
}

console.log(`\nDone. verified=${ok}, discrepancies=${discrepancies}, failed=${fail}`);

try {
  await sb.from("scraper_runs").insert({
    source: "verify_bill_status_ai",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: fail > ok ? "error" : "success",
    rows_added: discrepancies,
    rows_updated: ok,
    notes: `${ok} verified, ${discrepancies} discrepancies flagged, ${fail} failed`,
  });
} catch { /* best-effort */ }
