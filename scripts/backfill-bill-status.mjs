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
 *
 * --actions-only skips class 2, so nothing is marked dead just for being old.
 * That is the nightly run: a bill with wording we don't recognise yet may have
 * passed, and "Dead" on a law is the worst label we can show (LA SB 154).
 *
 * --legiscan also asks LegiScan about every bill that has stopped moving, plus
 * enacted ones, which proves passage no wording here knows and flags an
 * "enacted" row LegiScan says isn't. One counted call per bill, so run it by
 * hand: node --env-file=.env.local scripts/backfill-bill-status.mjs --legiscan
 *
 * Both sync sources can write a row for one bill. Rows behind their twin's
 * terminal status are moved up to it, so one bill can't read two ways.
 */
import { createClient } from "@supabase/supabase-js";
import {
  terminalStatusFromAction,
  statusFromLegiscanCode,
  legiscanSessionFits,
  twinCorrections,
  TERMINAL_STATUSES,
} from "./lib/bill-status.mjs";
import { createLegiscanClient, legiscanCallsThisMonth, remainingFor } from "./lib/legiscan-budget.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";

const APPLY = process.argv.includes("--apply");
const ACTIONS_ONLY = process.argv.includes("--actions-only");
const LEGISCAN = process.argv.includes("--legiscan");
const stateArg = process.argv.find((a) => a.startsWith("--state="))?.split("=")[1]?.toUpperCase() ?? null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

await runWithLogging({ source: "backfill_bill_status", supabase }, async () => {
  let q = supabase
    .from("bills")
    .select("id, state, bill_number, status, last_action, last_action_at, active, signed_at, legiscan_bill_id")
    .order("state", { ascending: true })
    .limit(10000);
  if (stateArg) q = q.eq("state", stateArg);
  const { data: bills, error } = await q;
  if (error) throw new Error(`bills query failed: ${error.message}`);

  // LegiScan's code per bill id, for the rows it can settle.
  const codes = new Map();
  if (LEGISCAN) {
    const used = await legiscanCallsThisMonth(supabase);
    const client = createLegiscanClient(process.env.LEGISCAN_API_KEY, { maxCalls: remainingFor(used) });
    const stopped = bills.filter((b) => b.legiscan_bill_id && (b.active === false || TERMINAL_STATUSES.has(b.status)));
    for (const b of stopped) {
      const res = await client.call("getBill", { id: b.legiscan_bill_id });
      if (!res?.bill || !legiscanSessionFits(b.last_action_at, res.bill.session)) continue;
      const history = res.bill.history ?? [];
      codes.set(b.id, { code: Number(res.bill.status), lastAction: history[history.length - 1]?.action ?? b.last_action });
    }
    console.log(`LegiScan: read ${codes.size} of ${stopped.length} stopped bills`);
  }

  const plan = [];
  const flagged = []; // contradictions we DON'T auto-change (terminal status vs death-signal action)
  for (const b of bills) {
    const cur = b.status ?? "";
    const t = terminalStatusFromAction(b.last_action);
    const proof = codes.has(b.id)
      ? statusFromLegiscanCode({ ...codes.get(b.id), billNumber: b.bill_number })
      : null;
    let next = null;
    let reason = null;
    if (cur === "enacted" && codes.has(b.id) && proof !== "enacted") {
      flagged.push({ ...b, ...codes.get(b.id) }); // LegiScan disagrees it passed. A person decides.
      continue;
    }
    if (proof && proof !== cur && cur !== "enacted" && !(proof === "dead" && TERMINAL_STATUSES.has(cur))) {
      plan.push({ b, next: proof, reason: `LegiScan code ${codes.get(b.id).code}` });
      continue;
    }
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
    } else if (!t && !ACTIONS_ONLY && b.active === false && !TERMINAL_STATUSES.has(cur)) {
      next = "dead";
      reason = "session-ended (active=false, non-terminal)";
    }
    if (next && next !== cur) plan.push({ b, next, reason });
  }

  // Twins, judged on the statuses this run is about to write.
  const planned = new Map(plan.map((p) => [p.b.id, p.next]));
  const byId = new Map(bills.map((b) => [b.id, b]));
  for (const { id, next } of twinCorrections(bills.map((b) => ({ ...b, status: planned.get(b.id) ?? b.status })))) {
    const existing = plan.find((p) => p.b.id === id);
    if (existing) existing.next = next;
    else plan.push({ b: byId.get(id), next, reason: "twin row" });
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
  for (const p of plan.slice(0, LEGISCAN ? 200 : 20)) {
    console.log(`  ${p.b.state} ${p.b.bill_number}: ${p.b.status} → ${p.next}  [${p.reason}]  «${String(p.b.last_action ?? "").slice(0, 60)}»`);
  }

  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} FLAGGED (terminal status but death-signal last_action — NOT auto-changed, review manually):`);
    for (const b of flagged.slice(0, 60)) {
      console.log(`  ${b.state} ${b.bill_number}: status=${b.status} signed_at=${b.signed_at ?? "null"}  code=${b.code ?? "-"} «${String(b.last_action ?? "").slice(0, 55)}»`);
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
