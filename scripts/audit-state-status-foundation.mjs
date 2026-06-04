#!/usr/bin/env node
/**
 * State Mission Control — foundation audit (read-only).
 *
 * Per STATE_MISSION_CONTROL_PLAN.md §5: re-run after PR1 (substance/7-OH
 * classification) to confirm coverage jumped BEFORE building the
 * state_status storage + UI (PR2-PR5). Recreates the audit logic that
 * was deleted after the first run.
 *
 * It does NOT write anything. It derives, per state, a draft leaf-status
 * and 7-OH-status from scope='state' bills using the substance_targeting
 * map + targets_* columns this repo now populates, weights enacted bills,
 * and checks the derivation against the 2026-06-01 ground truth so we can
 * see where naive derivation still disagrees (→ those are the cases the
 * PR4 admin confirm queue must resolve).
 *
 * The headline metric: how many states now have a NON-empty 7-OH signal
 * (this was ~0 before PR1 — that gap was the whole reason PR1 existed).
 *
 * Run: node --env-file=.env.local scripts/audit-state-status-foundation.mjs
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Ground truth verified 2026-06-01 (see plan §1).
const BAN_STATES = ["AL", "AR", "CT", "IN", "KS", "LA", "MI", "VT", "WI", "CA"];
const TARGETED = new Set(["bans", "restricts", "schedules"]);
const BANNED_STANCE = new Set(["bans", "schedules"]);

function isEnacted(b) {
  return b.status === "enacted" || !!b.signed_at || !!b.effective_date;
}

// Derive a state's leaf + 7-OH status from one bill's substance map.
function billSignal(b) {
  const st = b.substance_targeting;
  let leaf = null, sevenoh = null;
  if (st && typeof st === "object") {
    const nl = st.natural_leaf?.stance, mg = st.mitragynine?.stance, so = st.seven_oh?.stance, sy = st.synthetic?.stance;
    if (BANNED_STANCE.has(nl) || BANNED_STANCE.has(mg)) leaf = "banned";
    else if (nl === "restricts" || mg === "restricts") leaf = "restricted";
    else if (nl === "preserves" || mg === "preserves") leaf = "protected";
    if (BANNED_STANCE.has(so)) sevenoh = "banned";
    else if (so === "restricts") sevenoh = "restricted";
    else if (so === "preserves") sevenoh = "protected";
    // synthetic-axis ban with leaf preserved still implies 7-OH curtailed
    if (!sevenoh && (BANNED_STANCE.has(sy) || sy === "restricts") && (leaf === "protected" || leaf === null)) sevenoh = "restricted";
  }
  // Fall back to the binary columns if the map was sparse
  if (!leaf && b.targets_natural_leaf) leaf = "restricted";
  if (!sevenoh && b.targets_synthetic_only) sevenoh = "restricted";
  return { leaf, sevenoh };
}

const RANK = { banned: 3, restricted: 2, protected: 1 }; // strongest wins per axis

const { data: bills, error } = await sb
  .from("bills")
  .select("state, bill_number, status, signed_at, effective_date, kratom_relevance, substance_targeting, targets_natural_leaf, targets_synthetic_only")
  .eq("scope", "state").eq("active", true);
if (error) { console.error(error.message); process.exit(1); }

const byState = {};
for (const b of bills) {
  if (!/^[A-Z]{2}$/.test(b.state || "")) continue; // skip "US"/junk
  (byState[b.state] ??= []).push(b);
}

function deriveState(rows) {
  // Prefer enacted bills; fall back to all active if no enacted signal.
  const enacted = rows.filter(isEnacted);
  const pool = enacted.length ? enacted : rows;
  let leaf = null, sevenoh = null, leafFrom = null;
  for (const b of pool) {
    const s = billSignal(b);
    if (s.leaf && (!leaf || RANK[s.leaf] > RANK[leaf])) { leaf = s.leaf; leafFrom = b.bill_number; }
    if (s.sevenoh && (!sevenoh || RANK[s.sevenoh] > RANK[sevenoh])) sevenoh = s.sevenoh;
  }
  return { leaf, sevenoh, enactedCount: enacted.length, basedOn: enacted.length ? "enacted" : "all-active", leafFrom };
}

const states = Object.keys(byState).sort();
let sevenohCovered = 0, leafCovered = 0;
const banMisses = [];
const rowsOut = [];
for (const s of states) {
  const d = deriveState(byState[s]);
  if (d.sevenoh) sevenohCovered++;
  if (d.leaf) leafCovered++;
  const isBan = BAN_STATES.includes(s);
  // Ground-truth check: a known ban state should derive leaf banned/restricted.
  const banOk = !isBan || (d.leaf === "banned" || d.leaf === "restricted");
  if (isBan && !banOk) banMisses.push(s);
  rowsOut.push({ s, ...d, isBan, banOk });
}

console.log(`\n=== STATE STATUS FOUNDATION AUDIT (${states.length} states, ${bills.length} active state bills) ===\n`);
console.log(`leaf-status derivable:  ${leafCovered}/${states.length} states`);
console.log(`7-OH-status derivable:  ${sevenohCovered}/${states.length} states   ← was ~0 before PR1`);
console.log(`ban-state leaf accuracy: ${BAN_STATES.length - banMisses.length}/${BAN_STATES.length}${banMisses.length ? ` (MISS: ${banMisses.join(", ")})` : " ✓ all ban states derive restricted/banned"}\n`);

console.log("state | leaf | 7-OH | basis(#enacted) | groundtruth");
for (const r of rowsOut) {
  const flag = r.isBan ? (r.banOk ? "ban✓" : "BAN-MISS") : "";
  console.log(`  ${r.s}  | ${(r.leaf ?? "—").padEnd(10)} | ${(r.sevenoh ?? "—").padEnd(10)} | ${r.basedOn}(${r.enactedCount}) ${flag}`);
}

console.log("\nNote: this is naive single-pass derivation. Disagreements vs ground truth + low-coverage states are exactly what the PR3 reconciliation + PR4 admin confirm queue resolve. Local ordinances (scope!=state) are intentionally excluded.");
