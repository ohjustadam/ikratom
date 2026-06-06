#!/usr/bin/env node
/**
 * derive-state-status.mjs — State Mission Control PR2.
 *
 * Recompute the canonical per-state leaf + 7-OH status into `state_status`
 * from ENACTED, scope='state' bills and their substance_targeting map. This
 * is the WRITE version of the proven read-only audit
 * (scripts/audit-state-status-foundation.mjs) — same calibration, now
 * persisted, with edge cases flagged needs_review=true for the admin queue.
 *
 * Calibration (do not "simplify" — the audit proved each rule earns its keep):
 *   - Pool = ENACTED bills only (status='enacted' | signed_at | effective_date);
 *     fall back to all-active ONLY when a state has no enacted signal. A
 *     status derived from the all-active fallback is a PENDING THREAT, not
 *     current law → flagged needs_review.
 *   - Strict scope='state' + active=true (county/municipal ordinances must
 *     NOT roll up into statewide status — fixes the MS conflation).
 *   - Per-axis RANK: banned(3) > restricted(2) > protected(1); strongest wins.
 *   - 7-OH may be INFERRED from a synthetic-axis ban when leaf is protected/
 *     null (KCPA-style) — but that inference is flagged for review (catches
 *     the MN/NY/SD/WY false positives).
 *   - Ban-state ground truth: a known ban state that derives null/protected
 *     leaf is a MISS (statute-only IN/LA) → needs_review, never silently wrong.
 *
 * Admin override columns (admin_leaf_status, admin_7oh_status, admin_note,
 * confirmed_*) are PRESERVED across runs — the upsert only writes derived_*
 * + review fields, so a human confirmation is never clobbered.
 *
 * Usage:
 *   node --env-file=.env.local scripts/derive-state-status.mjs            # dry-run (prints table)
 *   node --env-file=.env.local scripts/derive-state-status.mjs --apply    # write to state_status
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Ground truth for ban-state misses (from V2_KICKOFF verification 2026-06-01).
// The 9 statewide statutory ban states (ground truth verified 2026-06-01).
// CA removed: it's a legal market (local bans only) — its statewide-ban entry
// here was polluting the review queue (FULL_AUDIT §4.1).
const BAN_STATES = new Set(["AL", "AR", "CT", "IN", "KS", "LA", "MI", "VT", "WI"]);
const BANNED_STANCE = new Set(["bans", "schedules"]);
const RANK = { banned: 3, restricted: 2, protected: 1 };
const STATE_RE = /^[A-Z]{2}$/;

function isEnacted(b) {
  return b.status === "enacted" || !!b.signed_at || !!b.effective_date;
}

/** Per-bill leaf/7-OH signal from substance_targeting (+ binary fallback). */
function billSignal(b) {
  const st = b.substance_targeting;
  let leaf = null;
  let sevenoh = null;
  let sevenohInferred = false;
  if (st && typeof st === "object") {
    const nl = st.natural_leaf?.stance;
    const mg = st.mitragynine?.stance;
    const so = st.seven_oh?.stance;
    const sy = st.synthetic?.stance;
    if (BANNED_STANCE.has(nl) || BANNED_STANCE.has(mg)) leaf = "banned";
    else if (nl === "restricts" || mg === "restricts") leaf = "restricted";
    else if (nl === "preserves" || mg === "preserves") leaf = "protected";

    if (BANNED_STANCE.has(so)) sevenoh = "banned";
    else if (so === "restricts") sevenoh = "restricted";
    else if (so === "preserves") sevenoh = "protected";
    // Synthetic-axis ban with leaf preserved/unknown implies 7-OH curtailed,
    // but flag the inference (KCPA false-positive guard).
    if (!sevenoh && (BANNED_STANCE.has(sy) || sy === "restricts") && (leaf === "protected" || leaf === null)) {
      sevenoh = "restricted";
      sevenohInferred = true;
    }
  }
  if (!leaf && b.targets_natural_leaf) leaf = "restricted";
  if (!sevenoh && b.targets_synthetic_only) {
    sevenoh = "restricted";
    sevenohInferred = true;
  }
  return { leaf, sevenoh, sevenohInferred };
}

/** Aggregate a state's bills → strongest signal per axis, with provenance. */
function deriveState(rows) {
  const enacted = rows.filter(isEnacted);
  const pool = enacted.length ? enacted : rows;
  const basis = enacted.length ? "enacted" : "all-active";
  let leaf = null;
  let sevenoh = null;
  let leafFrom = null;
  let sevenohFrom = null;
  let sevenohInferred = false;
  for (const b of pool) {
    const s = billSignal(b);
    if (s.leaf && (!leaf || RANK[s.leaf] > RANK[leaf])) {
      leaf = s.leaf;
      leafFrom = b.bill_number ?? null;
    }
    if (s.sevenoh) {
      // Strongest rank wins; on an equal-rank TIE prefer a DIRECT seven_oh
      // stance over a synthetic-axis inference, so the "inferred" review flag
      // is deterministic regardless of bill processing order (it fires only
      // when no direct stance backs the winning rank).
      const stronger = !sevenoh || RANK[s.sevenoh] > RANK[sevenoh];
      const tieUpgrade = sevenoh && RANK[s.sevenoh] === RANK[sevenoh] && sevenohInferred && !s.sevenohInferred;
      if (stronger || tieUpgrade) {
        sevenoh = s.sevenoh;
        sevenohFrom = b.bill_number ?? null;
        sevenohInferred = s.sevenohInferred;
      }
    }
  }
  return { leaf, sevenoh, basis, enactedCount: enacted.length, leafFrom, sevenohFrom, sevenohInferred };
}

const { data: bills, error } = await sb
  .from("bills")
  .select("state, status, signed_at, effective_date, substance_targeting, targets_natural_leaf, targets_synthetic_only, bill_number")
  .eq("scope", "state")
  .eq("active", true)
  .order("bill_number", { ascending: true }); // stable order → reproducible evidence bills
if (error) {
  console.error("Failed to read bills:", error.message);
  process.exit(1);
}

// state_status.state has an FK to states(abbr). Load the real set of states
// so a stray/territory code (valid 2-letter format but absent from states)
// can't FK-fail the entire upsert batch and zero out the whole publish.
const { data: stateRows } = await sb.from("states").select("abbr");
const validStates = new Set((stateRows ?? []).map((s) => s.abbr));

// Group by valid 2-letter state (skips 'US' federal placeholder + junk, plus
// any code not present in the states table). Fail-open if the states lookup
// returned nothing, so a transient read error can't drop every state.
const byState = new Map();
for (const b of bills ?? []) {
  if (!b.state || !STATE_RE.test(b.state)) continue;
  if (validStates.size && !validStates.has(b.state)) continue;
  if (!byState.has(b.state)) byState.set(b.state, []);
  byState.get(b.state).push(b);
}

const nowIso = new Date().toISOString();
const records = [];
for (const [state, rows] of byState) {
  const d = deriveState(rows);

  const reasons = [];
  // 1. Ban-state miss: known ban state derives null/protected leaf → statute-only.
  if (BAN_STATES.has(state) && (d.leaf === null || d.leaf === "protected")) {
    reasons.push("ban-state-miss");
  }
  // 2. Pending-only: a banned/restricted status with no enacted basis is a
  //    threat, not current law (FL/TX/UT false positives).
  if (d.basis === "all-active" && (["banned", "restricted"].includes(d.leaf) || ["banned", "restricted"].includes(d.sevenoh))) {
    reasons.push("pending-only-no-enacted-basis");
  }
  // 3. 7-OH inferred from synthetic-axis (KCPA) rather than a direct stance.
  if (d.sevenohInferred) reasons.push("7oh-inferred-from-synthetic");

  records.push({
    state,
    derived_leaf_status: d.leaf,
    derived_7oh_status: d.sevenoh,
    basis: d.basis,
    enacted_count: d.enactedCount,
    leaf_evidence_bill: d.leafFrom,
    sevenoh_evidence_bill: d.sevenohFrom,
    needs_review: reasons.length > 0,
    review_reason: reasons.length ? reasons.join(", ") : null,
    derived_at: nowIso,
    updated_at: nowIso,
  });
}

records.sort((a, b) => a.state.localeCompare(b.state));
const flagged = records.filter((r) => r.needs_review);
console.log(`Derived ${records.length} states · ${flagged.length} need review.`);
for (const r of records) {
  const flag = r.needs_review ? `  ⚠ ${r.review_reason}` : "";
  console.log(
    `  ${r.state}  leaf=${r.derived_leaf_status ?? "-"} 7oh=${r.derived_7oh_status ?? "-"} ` +
      `[${r.basis}, enacted=${r.enacted_count}]${flag}`,
  );
}

let status = "success";
let wrote = 0;
if (APPLY) {
  // Upsert ONLY the derived + review columns so admin override/confirm
  // fields (admin_leaf_status, admin_7oh_status, admin_note, confirmed_*)
  // set by a human are preserved across recomputes.
  const { error: upErr, count } = await sb
    .from("state_status")
    .upsert(records, { onConflict: "state", count: "exact" });
  if (upErr) {
    console.error("Upsert failed:", upErr.message);
    status = "failed";
  } else {
    wrote = count ?? records.length;
    console.log(`✅ Wrote ${wrote} state_status rows.`);
  }
} else {
  console.log("\n(dry-run — pass --apply to write to state_status)");
}

// Telemetry so /admin/automation + check-cron-staleness see this job run.
try {
  await sb.from("scraper_runs").insert({
    source: "derive_state_status",
    started_at: nowIso,
    finished_at: new Date().toISOString(),
    status,
    rows_added: APPLY ? wrote : 0,
    notes: `${records.length} states derived, ${flagged.length} flagged for review${APPLY ? "" : " (dry-run)"}`,
  });
} catch {
  /* best-effort */
}

if (status === "failed") process.exit(1);
