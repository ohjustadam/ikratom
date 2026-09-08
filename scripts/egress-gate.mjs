#!/usr/bin/env node
/**
 * egress-gate.mjs — the load-shedding gate for the cron fleet.
 *
 * Run as the FIRST job in a cron workflow. It emits `run=true|false` to
 * $GITHUB_OUTPUT; every deferrable job declares `needs: budget` and
 * `if: needs.budget.outputs.run == 'true'`.
 *
 * Gating at the WORKFLOW level rather than inside each script is deliberate:
 * one place to reason about, no chance of a script being added later and
 * silently escaping the gate, and a job that never starts spends nothing at all
 * — not even the gate's own query.
 *
 * Exits 0 either way. A gate that fails the workflow would turn "we are being
 * careful with the budget" into a red build and a pager alert, which is exactly
 * the wrong signal.
 *
 *   node scripts/egress-gate.mjs --tier normal
 *   node scripts/egress-gate.mjs --tier bulk --json
 */
import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { checkEgressBudget, getEgressStatus, BUDGET_GB } from "./lib/egress-budget.mjs";

const args = process.argv.slice(2);
const tier = args.includes("--tier") ? args[args.indexOf("--tier") + 1] : "normal";
const asJson = args.includes("--json");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const status = await getEgressStatus(sb);
const gate = await checkEgressBudget(tier, sb);

const pctText = status.pct == null ? "unknown" : `${(status.pct * 100).toFixed(1)}%`;
console.log(`egress-gate[${tier}]: ${pctText} of ${BUDGET_GB}GB · ${gate.skip ? "DEFER" : "RUN"}`);
console.log(`  ${gate.reason}`);
if (status.usedMb != null) {
  console.log(`  ~${status.usedMb.toFixed(0)} MB billable this cycle from ${status.readings} watchdog readings`);
}

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${gate.skip ? "false" : "true"}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `pct=${status.pct == null ? "" : (status.pct * 100).toFixed(1)}\n`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Supabase egress gate (${tier})\n\n**${pctText}** of ${BUDGET_GB} GB — ${gate.skip ? "🛑 deferring background work" : "✅ clear to run"}\n\n${gate.reason}\n`,
  );
}

// Record the DEFER decision so a quiet fleet is explainable after the fact.
// Not recorded on the pass path: that would add a row every two hours to the
// table the staleness watchdog reads.
if (gate.skip) {
  try {
    await sb.from("scraper_runs").insert({
      source: "egress_gate",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "skipped",
      rows_updated: 0,
      notes: gate.reason.slice(0, 300),
    });
  } catch { /* best-effort */ }
}

if (asJson) console.log(JSON.stringify({ tier, run: !gate.skip, pct: status.pct, usedMb: status.usedMb }));
process.exit(0);
