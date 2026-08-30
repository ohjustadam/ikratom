#!/usr/bin/env node
/**
 * netlify-credit-gate.mjs — the BRAKE. Refuses to let a deploy happen when the
 * Netlify credit budget is nearly spent.
 *
 * WHY: on 2026-07-30 www.ikratom.org was disabled with
 * `disabled_reason: "Account usage exceeded for credits"`. 15 production deploys
 * at 15 credits each = 225 of the 300-credit monthly budget — 75% of everything
 * we had, spent on shipping. Most of those were fix-forward commits chasing the
 * Netlify migration itself.
 *
 * Traffic we cannot throttle. Deploys we can. This gate makes the controllable
 * 75% of the burn physically unable to take the site down: past the brake
 * threshold it exits non-zero, the required CI check goes red, branch protection
 * refuses the merge, and Netlify never builds.
 *
 * It is deliberately a GATE, not a notification. The 2026-07 lesson is that a
 * warning nobody is forced to act on is indistinguishable from no warning.
 *
 * Usage:
 *   node --env-file=.env.local scripts/netlify-credit-gate.mjs
 *   node scripts/netlify-credit-gate.mjs --threshold 80
 *   node scripts/netlify-credit-gate.mjs --warn-only     # never fails the build
 *
 * Exit codes: 0 = clear to deploy, 1 = braked, 0 = skipped (no token).
 */
import {
  estimateNetlifyCredits,
  creditSeverity,
  CREDIT_THRESHOLDS,
} from "./lib/netlify-credits.mjs";

const argv = process.argv.slice(2);
const WARN_ONLY = argv.includes("--warn-only");
const tIdx = argv.indexOf("--threshold");
const THRESHOLD = tIdx >= 0 ? Number(argv[tIdx + 1]) : CREDIT_THRESHOLDS.brake;

const token = process.env.NETLIFY_AUTH_TOKEN;
const accountSlug = process.env.NETLIFY_ACCOUNT_SLUG || "ohjustadam";
const siteId = process.env.NETLIFY_SITE_ID || "de541c33-9185-4be7-a961-0fe09c868557";

if (!token) {
  // A missing token must not become a silent green light, but it also must not
  // block every PR from a fork/CI context that legitimately has no secret.
  console.log("⚠ NETLIFY_AUTH_TOKEN not set — credit gate SKIPPED (not a pass).");
  process.exit(0);
}

let est;
try {
  est = await estimateNetlifyCredits({ token, accountSlug, siteId });
} catch (e) {
  console.log(`⚠ credit gate could not read Netlify (${e.message}) — SKIPPED.`);
  process.exit(0);
}

if (!est.ok) {
  console.log(`⚠ credit gate skipped: ${est.reason}`);
  process.exit(0);
}

const sev = creditSeverity(est.pct);
console.log("── Netlify credit budget ────────────────────────────────");
console.log(`  period       ${String(est.periodStart).slice(0, 10)} → ${String(est.periodEnd).slice(0, 10)}`);
console.log(`  deploys      ${est.deploys} × ${15} = ${est.deployCredits} credits`);
console.log(`  bandwidth    ${est.bandwidthGb.toFixed(2)} GB × 20 = ${est.bandwidthCredits.toFixed(0)} credits`);
console.log(`  measured     ${est.usedFloor.toFixed(0)} credits (deploys + bandwidth only)`);
console.log(`  requests+compute (not exposed by Netlify) ≈ ${est.blindCredits.toFixed(0)} projected`);
console.log(`  PROJECTED    ${est.projectedUsed.toFixed(0)} / ${est.planCredits}  (${est.pct.toFixed(1)}%)`);
console.log(`  severity     ${sev}   (brake at ${THRESHOLD}%)`);
console.log(`  Projection assumes the measurable floor is ${(est.floorShare * 100).toFixed(0)}% of real burn,`);
console.log("  calibrated 2026-08-30 against Netlify's own 75% alert. The floor alone");
console.log(`  reads only ${est.floorPct.toFixed(1)}% — do NOT quote that as the state of play.`);
console.log("─────────────────────────────────────────────────────────");

if (est.exceeded) {
  console.error(`\n✗ BRAKED — Netlify already reports credits exceeded at ${est.exceededAt}.`);
  console.error("  The site is disabled. Deploying now spends credits you do not have.");
  if (!WARN_ONLY) process.exit(1);
}

if (est.pct >= THRESHOLD) {
  console.error(`\n✗ BRAKED — measured burn ≥ ${THRESHOLD}% of the credit budget.`);
  console.error("  Batch the remaining work into ONE deploy, or wait for the reset on");
  console.error(`  ${String(est.periodEnd).slice(0, 10)}. Each production deploy costs 15 credits.`);
  if (!WARN_ONLY) process.exit(1);
  console.error("  (--warn-only set: not failing the build)");
}

if (sev === "critical") {
  console.log(`\n⚠ ${est.pct.toFixed(0)}% spent — deploy only if this change matters today.`);
} else if (sev === "warn") {
  console.log(`\n⚠ ${est.pct.toFixed(0)}% spent — start batching PRs into single deploys.`);
} else {
  console.log("\n✓ Clear to deploy.");
}
process.exit(0);
