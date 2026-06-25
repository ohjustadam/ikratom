#!/usr/bin/env node
/**
 * One-time (re-runnable, idempotent) bill-status corrector.
 *
 * Two classes of stale status got bills stuck reading "in process" forever:
 *   1. Terminal transitions the narrow old derivation missed — a bill whose
 *      `last_action` says "Becomes law without Governor's signature" / "Approved
 *      by Governor" / "Act No. 35" / "Signed by the Governor" but whose status
 *      still says passed_chamber / introduced. We re-derive enacted/vetoed/dead
 *      from `last_action` via the shared scripts/lib/bill-status.mjs helper.
 *   2. Bills whose session concluded (`active=false`) but never reached a
 *      terminal status — these are dead-in-session and get marked `dead`.
 *
 * Conservative by design: a terminal signal overrides a non-terminal status;
 * an ABSENT signal never downgrades an active bill (we don't touch
 * introduced/committee/passed_chamber on live bills). Never overwrites a status
 * that's already terminal with a different terminal value.
 *
 *   node --env-file=.env.local scripts/backfill-bill-status.mjs            # dry-run
 *   node --env-file=.env.local scripts/backfill-bill-status.mjs --apply    # write
 *   node --env-file=.env.local scripts/backfill-bill-status.mjs --state=OK # scope
 */
import { createClient } from "@supabase/supabase-js";
import { terminalStatusFromAction, TERMINAL_STATUSES } from "./lib/bill-status.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const APPLY = process.argv.includes("--apply");
const stateArg = process.argv.find((a) => a.startsWith("--state="))?.split("=")[1]?.toUpperCase() ?? null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

await runWithLogging({ source: "backfill_bill_status", supabase }, async () => {
  let q = supabase
    .from("bills")
    .select("id, state, bill_number, status, last_action, last_action_at, active, signed_at")
    .order("state", { ascending: true })
    .limit(10000);
  if (stateArg) q = q.eq("state", stateArg);
  const { data: bills, error } = await q;
  if (error) throw new Error(`bills query failed: ${error.message}`);

  const plan = [];
  const flagged = []; // contradictions we DON'T auto-change (terminal status vs death-signal action)
  for (const b of bills) {
    const cur = b.status ?? "";
    const t = terminalStatusFromAction(b.last_action);
    let next = null;
    let reason = null;
    // PROMOTE toward truth; never downgrade an existing terminal status via a
    // regex guess (a genuinely-signed bill with a stray procedural death-word
    // must not flip to dead). enacted > vetoed; dead only from non-terminal.
    if (t === "enacted" && cur !== "enacted") {
      next = "enacted";
      reason = "action→enacted";
    } else if (t === "vetoed" && cur !== "vetoed" && cur !== "enacted") {
      next = "vetoed";
      reason = "action→vetoed";
    } else if (t === "dead" && !TERMINAL_STATUSES.has(cur)) {
      next = "dead";
      reason = "action→dead";
    } else if (t === "dead" && TERMINAL_STATUSES.has(cur) && cur !== "dead") {
      // Marked enacted/vetoed but the last action explicitly says "Died in
      // committee"/"Indefinitely Postponed". A genuine enactment always carries
      // a signed_at stamp — its ABSENCE confirms a stale mislabel, so correct it.
      // If signing evidence exists, leave it and flag for human review instead.
      if (!b.signed_at) {
        next = "dead";
        reason = `mislabeled ${cur}→dead (signed_at null, action=died)`;
      } else {
        flagged.push(b);
      }
    } else if (!t && b.active === false && !TERMINAL_STATUSES.has(cur)) {
      next = "dead";
      reason = "session-ended (active=false, non-terminal)";
    }
    if (next && next !== cur) plan.push({ b, next, reason });
  }

  // Summarize
  const byTransition = {};
  for (const p of plan) {
    const k = `${p.b.status ?? "(null)"} → ${p.next}`;
    byTransition[k] = (byTransition[k] || 0) + 1;
  }
  console.log(`\n=== backfill-bill-status ${APPLY ? "(APPLY)" : "(dry-run)"}${stateArg ? ` state=${stateArg}` : ""} ===`);
  console.log(`scanned ${bills.length} bills · ${plan.length} need correction\n`);
  console.log("transitions:");
  for (const [k, n] of Object.entries(byTransition).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
  console.log("\nsamples:");
  for (const p of plan.slice(0, 20)) {
    console.log(`  ${p.b.state} ${p.b.bill_number}: ${p.b.status} → ${p.next}  [${p.reason}]  «${String(p.b.last_action ?? "").slice(0, 60)}»`);
  }

  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} FLAGGED (terminal status but death-signal last_action — NOT auto-changed, review manually):`);
    for (const b of flagged.slice(0, 15)) {
      console.log(`  ${b.state} ${b.bill_number}: status=${b.status} signed_at=${b.signed_at ?? "null"}  «${String(b.last_action ?? "").slice(0, 55)}»`);
    }
  }

  if (!APPLY) {
    console.log(`\n(dry-run — re-run with --apply to write ${plan.length} updates)`);
    return { rowsUpdated: 0, notes: `dry-run: ${plan.length} candidates` };
  }

  let updated = 0;
  let failed = 0;
  for (const p of plan) {
    const patch = { status: p.next };
    // Stamp the enactment date from the action that enacted it, when unknown.
    if (p.next === "enacted" && !p.b.signed_at && p.b.last_action_at) patch.signed_at = p.b.last_action_at;
    const { error: uerr } = await supabase.from("bills").update(patch).eq("id", p.b.id);
    if (uerr) {
      failed++;
      console.error(`  ✗ ${p.b.state} ${p.b.bill_number}: ${uerr.message}`);
    } else {
      updated++;
    }
  }
  console.log(`\napplied: ${updated} updated, ${failed} failed`);
  return { rowsUpdated: updated, notes: `${updated} status corrections (${failed} failed)${stateArg ? ` [${stateArg}]` : ""}` };
});
