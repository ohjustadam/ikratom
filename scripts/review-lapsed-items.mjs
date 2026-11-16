/**
 * review-lapsed-items.mjs — the daily failsafe against stale / revolving bills.
 *
 * Owner directive (2026-07-11): proposed legislation that dies when a session
 * ends must stop showing as active, and everything tied to it (alerts,
 * campaigns) is updated in the same pass. "It all must have a beginning and an
 * end, and an if/then or two."
 *
 * THE IF/THENS (see scripts/lib/review-dates.mjs):
 *   1. Stamp review_by up front (session end) on any active bill missing it.
 *   2. IF the session is over (LegiScan sine_die, or review_by lapsed) AND the
 *      bill never became law AND nothing happened in ~21d → RETIRE it.
 *   3. CASCADE: retire its auto-generated campaigns + retract its approved
 *      alerts; FLAG hand-authored campaigns for owner review (never auto-kill a
 *      standing campaign).
 *   4. REVIVE: a cron-retired bill whose session is actually current + has a
 *      fresh action comes back (revolving-bill guard).
 *   5. FLAG: bills.session_sine_die follows sessionFlag() on every open bill,
 *      active or not, in both directions, because the site shows it as
 *      "Session ended". A terminal status outranks the label (#1129), so those
 *      rows are left alone unless they are city or county rows.
 *
 * All actions are reversible (active flags + notes) and logged. READ-ONLY unless
 * --apply.
 *   node --env-file=.env.local scripts/review-lapsed-items.mjs [--apply]
 */
import { createClient } from "@supabase/supabase-js";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { TERMINAL_STATUSES } from "./lib/bill-status.mjs";
import {
  inLegislativeSession,
  matchSession,
  sessionEnded,
  sessionFlag,
  sessionReviewBy,
  shouldRetire,
  shouldRevive,
} from "./lib/review-dates.mjs";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const APPLY = process.argv.includes("--apply");
const NOTE_PREFIX = "Auto-retired by review cron";
const today = new Date().toISOString().slice(0, 10);

/** Build state → sessions[] for sine_die matching. */
async function loadSessions() {
  const { data } = await supabase
    .from("legislative_sessions")
    .select("state, legiscan_session_id, session_name, year_start, year_end, special, sine_die");
  const byState = new Map();
  for (const s of data ?? []) {
    if (!byState.has(s.state)) byState.set(s.state, []);
    byState.get(s.state).push(s);
  }
  return byState;
}

/** Every bill, paged: .limit() stops at PostgREST's 1,000-row cap. */
async function loadAllBills() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("bills")
      .select("id, state, bill_number, session_id, scope, status, last_action, last_action_at, session_sine_die")
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(`bills read failed: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** Bring session_sine_die in line with sessionFlag(). Returns the rows it moved. */
async function syncSessionFlags(byState) {
  const moved = [];
  for (const b of await loadAllBills()) {
    if (TERMINAL_STATUSES.has(b.status) && inLegislativeSession(b)) continue;
    const want = sessionFlag(b, byState.get(b.state));
    if (want !== b.session_sine_die) moved.push({ ...b, want });
  }
  if (APPLY) {
    for (const want of [true, false]) {
      const ids = moved.filter((m) => m.want === want).map((m) => m.id);
      if (!ids.length) continue;
      const { error } = await supabase.from("bills").update({ session_sine_die: want }).in("id", ids);
      if (error) throw new Error(`session flag write failed: ${error.message}`);
    }
  }
  return moved;
}

async function cascade(billId, dry) {
  const out = { campRetired: 0, campFlagged: 0, alertsRetracted: 0 };
  // Campaigns tied to this bill.
  const { data: camps } = await supabase
    .from("campaigns")
    .select("id, active, auto_generated, is_standing, review_state")
    .eq("bill_id", billId)
    .eq("active", true);
  for (const c of camps ?? []) {
    if (c.is_standing) continue; // never auto-kill a standing campaign
    if (c.auto_generated) {
      out.campRetired++;
      if (!dry) await supabase.from("campaigns").update({
        active: false, review_reason: `Bill retired ${today} (session over) — auto-generated campaign retired with it.`,
      }).eq("id", c.id);
    } else if (c.review_state !== "pending_review") {
      out.campFlagged++;
      if (!dry) await supabase.from("campaigns").update({
        review_state: "pending_review", review_reason: `Bill retired ${today} (session over) — hand-authored campaign flagged: confirm it should stay live.`,
      }).eq("id", c.id);
    }
  }
  // Approved alerts tied to this bill → retract + expire (reversible).
  const { data: alerts } = await supabase
    .from("policy_alerts")
    .select("id")
    .eq("bill_id", billId)
    .eq("moderation_status", "approved");
  for (const a of alerts ?? []) {
    out.alertsRetracted++;
    if (!dry) await supabase.from("policy_alerts").update({
      moderation_status: "rejected",
      moderation_note: `Bill retired ${today} (session over) — alert retracted with it.`,
      expires_at: new Date().toISOString(),
    }).eq("id", a.id);
  }
  return out;
}

await runWithLogging({ source: "review_lapsed_items", supabase }, async () => {
  const byState = await loadSessions();
  const now = Date.now();

  // ── 1+2+3: active bills → backfill review_by, retire lapsed, cascade ──
  const { data: active } = await supabase
    .from("bills")
    .select("id, state, bill_number, session_id, scope, status, active, last_action, last_action_at, review_by, kratom_relevance")
    .eq("active", true)
    .limit(10_000);

  let stamped = 0, retired = 0;
  const cascadeTotals = { campRetired: 0, campFlagged: 0, alertsRetracted: 0 };
  const sample = [];

  for (const b of active ?? []) {
    // 1. Stamp review_by up front if missing.
    if (!b.review_by) {
      const rb = sessionReviewBy(b, matchSession(b, byState.get(b.state)));
      if (rb) {
        b.review_by = rb;
        stamped++;
        if (APPLY) await supabase.from("bills").update({ review_by: rb }).eq("id", b.id);
      }
    }
    const sineDie = sessionEnded(b, byState.get(b.state));

    // 2. Retire?
    if (shouldRetire(b, { sineDie, now })) {
      retired++;
      if (sample.length < 30) sample.push(`${b.state} ${b.bill_number} [${b.status}] session=${b.session_id} sine_die=${sineDie} rel=${b.kratom_relevance}`);
      if (APPLY) {
        await supabase.from("bills").update({
          active: false,
          verification_note: `${NOTE_PREFIX} ${today}: session ${b.session_id} is over (sine_die=${sineDie}), bill did not pass (status=${b.status}). Reversible.`,
        }).eq("id", b.id);
      }
      // 3. Cascade.
      const c = await cascade(b.id, !APPLY);
      cascadeTotals.campRetired += c.campRetired;
      cascadeTotals.campFlagged += c.campFlagged;
      cascadeTotals.alertsRetracted += c.alertsRetracted;
    }
  }

  // ── 4: revive cron-retired bills whose session is actually current ──
  const { data: retiredBills } = await supabase
    .from("bills")
    .select("id, state, bill_number, session_id, scope, status, last_action, last_action_at, review_by, verification_note")
    .eq("active", false)
    .like("verification_note", `${NOTE_PREFIX}%`)
    .limit(10_000);
  let revived = 0;
  for (const b of retiredBills ?? []) {
    const sineDie = sessionEnded(b, byState.get(b.state));
    const retiredOn = b.verification_note?.match(/^Auto-retired by review cron (\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
    if (shouldRevive(b, { sineDie, now, retiredOn })) {
      revived++;
      if (APPLY) await supabase.from("bills").update({
        active: true,
        verification_note: `Revived ${today}: fresh action after auto-retire — session is current.`,
      }).eq("id", b.id);
    }
  }

  // ── 5: session_sine_die, on every row the label can reach ──
  const flagged = await syncSessionFlags(byState);
  const flagsOn = flagged.filter((f) => f.want).length;

  console.log(`\n${APPLY ? "APPLIED" : "DRY-RUN"} — reviewed ${(active ?? []).length} active bills`);
  console.log(`  review_by stamped: ${stamped}`);
  console.log(`  bills retired: ${retired}`);
  console.log(`  ↳ campaigns retired: ${cascadeTotals.campRetired} · flagged: ${cascadeTotals.campFlagged} · alerts retracted: ${cascadeTotals.alertsRetracted}`);
  console.log(`  bills revived: ${revived}`);
  console.log(`  session flags: ${flagsOn} set, ${flagged.length - flagsOn} cleared`);
  for (const f of flagged) console.log(`    ${f.want ? "+" : "-"} ${f.state} ${f.bill_number} [${f.status}] session=${f.session_id}`);
  if (sample.length) { console.log(`\n  sample retirements:`); for (const s of sample) console.log(`    ${s}`); }
  if (!APPLY) console.log(`\n  (dry-run — pass --apply to write)`);

  return {
    rowsUpdated: APPLY ? retired + revived + stamped + flagged.length : 0,
    notes: `stamped ${stamped}, retired ${retired} (camps ${cascadeTotals.campRetired}/${cascadeTotals.campFlagged}, alerts ${cascadeTotals.alertsRetracted}), revived ${revived}, session flags +${flagsOn}/-${flagged.length - flagsOn}${APPLY ? "" : " [dry-run]"}`,
  };
});
