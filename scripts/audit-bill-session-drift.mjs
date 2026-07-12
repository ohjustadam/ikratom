/**
 * audit-bill-session-drift.mjs — find & fix bills whose session label doesn't
 * match their live data.
 *
 * Two failure modes, both surfaced by the MI SB 433 investigation (2026-07-11):
 *   - FRANKENSTEIN: an old-session row that got a DIFFERENT (current-session)
 *     bill's actions/text stapled on because sync matched by bill_number only
 *     (MI SB 433: a dead 2019-2020 kratom row wearing a 2025-2026 THC school
 *     bill's text). Shows as an "active" threat that isn't real.
 *   - GARBAGE SESSION: a mis-parsed session label (e.g. "1841", "1728", "1958")
 *     — the year came from bill text, not the session.
 *   - DEAD: session closed AND no recent action → a concluded bill still marked
 *     active.
 *
 * READ-ONLY by default (prints a classified report). Targeted repair:
 *   node --env-file=.env.local scripts/audit-bill-session-drift.mjs \
 *     --deconflate <billId> [--apply]
 * De-conflation sets active=false + writes a verification_note + retracts any
 * auto-generated alerts on the row (they describe the wrong bill). Dry-run
 * unless --apply. The systemic sync guard lives in sync-bills-via-legiscan.mjs
 * (isSessionMismatch); this script cleans up rows already corrupted.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const deconflateIdx = args.indexOf("--deconflate");
const DECONFLATE_ID = deconflateIdx >= 0 ? args[deconflateIdx + 1] : null;
const NOW_YEAR = new Date().getFullYear();

function years(s) {
  const m = String(s ?? "").match(/(?:19|20)\d{2}/g);
  return m ? m.map(Number) : [];
}
function actionYear(iso) {
  const y = iso ? new Date(iso).getFullYear() : null;
  return Number.isFinite(y) ? y : null;
}

/** classify a row → null (fine) | 'garbage_session' | 'frankenstein' | 'dead' */
function classify(b) {
  const ys = years(b.session_id);
  const anyGarbage = ys.some((y) => y < 1990 || y > NOW_YEAR + 2);
  if (anyGarbage) return "garbage_session";
  if (ys.length === 0) return null;
  const end = Math.max(...ys);
  if (end > NOW_YEAR - 2) return null; // current/recent biennium — fine
  const ay = actionYear(b.last_action_at);
  if (ay && ay >= NOW_YEAR - 1) return "frankenstein"; // old session, fresh action
  return "dead";
}

async function retractAlerts(billId, apply) {
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("id, title, moderation_status")
    .eq("bill_id", billId)
    .eq("moderation_status", "approved");
  const list = alerts ?? [];
  for (const a of list) {
    console.log(`    ↳ alert ${a.id.slice(0, 8)} "${a.title.slice(0, 60)}" → retract`);
    if (apply) {
      await sb.from("policy_alerts").update({ moderation_status: "rejected" }).eq("id", a.id);
    }
  }
  return list.length;
}

async function deconflate(billId, apply) {
  const { data: b, error } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id, active, last_action_at, kratom_relevance, title")
    .eq("id", billId)
    .single();
  if (error || !b) { console.log(`Bill ${billId} not found: ${error?.message}`); return; }

  console.log(`\nDE-CONFLATE ${b.state} ${b.bill_number} (${b.id.slice(0, 8)})`);
  console.log(`  session=${b.session_id} active=${b.active} lastAction=${b.last_action_at} rel=${b.kratom_relevance}`);
  console.log(`  class=${classify(b) ?? "clean"}`);
  const note =
    `De-conflated ${new Date().toISOString().slice(0, 10)}: this record mixed a closed ` +
    `${b.session_id} row with a different current-session bill's data (bill_number reuse). ` +
    `Deactivated — not a live kratom threat. See audit-bill-session-drift.mjs.`;
  console.log(`  → set active=false, verification_note, retract approved alerts`);
  if (apply) {
    await sb.from("bills").update({ active: false, verification_note: note }).eq("id", b.id);
  }
  const n = await retractAlerts(b.id, apply);
  console.log(apply ? `  ✓ applied (${n} alert(s) retracted)` : `  (dry-run — pass --apply to write; ${n} alert(s) would retract)`);
}

async function report() {
  const { data: bills } = await sb
    .from("bills")
    .select("id, state, bill_number, session_id, active, last_action_at, kratom_relevance")
    .eq("active", true)
    .limit(5000);
  const buckets = { garbage_session: [], frankenstein: [], dead: [] };
  for (const b of bills ?? []) {
    const c = classify(b);
    if (c) buckets[c].push(b);
  }
  console.log(`\n=== bill session-drift audit (${(bills ?? []).length} active bills) ===`);
  for (const [k, arr] of Object.entries(buckets)) {
    console.log(`\n## ${k}: ${arr.length}`);
    for (const b of arr.slice(0, 40)) {
      console.log(`  ${b.state} ${b.bill_number}  session=${b.session_id}  lastAction=${b.last_action_at}  rel=${b.kratom_relevance}  ${b.id.slice(0, 8)}`);
    }
    if (arr.length > 40) console.log(`  … +${arr.length - 40} more`);
  }
  const total = Object.values(buckets).reduce((n, a) => n + a.length, 0);
  console.log(`\nTOTAL flagged: ${total} / ${(bills ?? []).length} active`);
  console.log(`\nRepair a specific record: --deconflate <billId> [--apply]`);
}

if (DECONFLATE_ID) await deconflate(DECONFLATE_ID, APPLY);
else await report();
