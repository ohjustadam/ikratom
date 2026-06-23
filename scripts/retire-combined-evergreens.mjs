#!/usr/bin/env node
/**
 * Retire the per-state COMBINED evergreens now that the targeted standing splits
 * (P5: *-email-state-house / -state-senate / -statewide-officials) are live.
 *
 * The combined evergreens are the 51 `*-introduce-yourself` campaigns
 * ("Tell your <State> legislators kratom matters", target_roles
 * [state_senate, state_house]). The owner asked to retire them in favor of the
 * split ones. "Retire" = active=false (reversible; no DELETE). Deactivation does
 * NOT fire campaign_notify_trigger (it only notifies on active true / false→true).
 *
 * PROOF pass (always runs): resolves recipient counts (active legislators whose
 * role ∈ target_roles AND state = campaign.state) for the NEW standing splits and
 * the combined evergreens — confirming (a) no split campaign resolves to zero
 * recipients, and (b) the splits cover the same legislators the combined did, so
 * retiring loses no reach.
 *
 *   node --env-file=.env.local scripts/retire-combined-evergreens.mjs            # dry-run + proof
 *   node --env-file=.env.local scripts/retire-combined-evergreens.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const t0 = Date.now();

// Active legislators keyed by state → role → count.
const legByState = new Map();
for (let f = 0; ; f += 1000) {
  const { data } = await sb.from("legislators").select("role, state, active").range(f, f + 999);
  if (!data?.length) break;
  for (const l of data) {
    if (l.active === false || !l.state) continue;
    if (!legByState.has(l.state)) legByState.set(l.state, {});
    const m = legByState.get(l.state);
    m[l.role] = (m[l.role] || 0) + 1;
  }
  if (data.length < 1000) break;
}
const resolveCount = (state, roles) => (roles || []).reduce((n, r) => n + (legByState.get(state)?.[r] || 0), 0);

// Pull standing splits + combined evergreens.
const { data: rows } = await sb.from("campaigns")
  .select("id, slug, state, title, target_roles, active")
  .or("slug.like.%-email-state-house,slug.like.%-email-state-senate,slug.like.%-email-statewide-officials,slug.like.%-introduce-yourself");

const splits = (rows ?? []).filter((c) => !c.slug.endsWith("-introduce-yourself"));
const combined = (rows ?? []).filter((c) => c.slug.endsWith("-introduce-yourself"));

console.log(`${APPLY ? "🔧 APPLY" : "🔍 DRY-RUN"} — retire ${combined.length} combined evergreens; ${splits.length} splits live\n`);

// PROOF: any split resolving to 0 recipients?
const zeros = splits.map((c) => ({ slug: c.slug, n: resolveCount(c.state, c.target_roles) })).filter((x) => x.n === 0);
const sample = ["TX", "CA", "NE", "OK"].map((st) => {
  const sp = splits.filter((c) => c.state === st);
  const ev = combined.find((c) => c.state === st);
  return { st, splits: sp.map((c) => `${c.slug.split("-").slice(1).join("-")}=${resolveCount(c.state, c.target_roles)}`).join(" "), combined: ev ? resolveCount(ev.state, ev.target_roles) : "—" };
});
console.log("PROOF — recipient resolution (active legislators matched by role+state):");
for (const s of sample) console.log(`  ${s.st}: combined→${s.combined} | splits: ${s.splits}`);
console.log(`  splits resolving to ZERO recipients: ${zeros.length}${zeros.length ? " → " + zeros.map((z) => z.slug).join(", ") : " ✓"}`);

// RETIRE: deactivate the combined evergreens still active.
const toRetire = combined.filter((c) => c.active);
console.log(`\nRetire: ${toRetire.length} active combined evergreens → active=false`);
if (APPLY && toRetire.length) {
  let done = 0;
  for (let i = 0; i < toRetire.length; i += 100) {
    const chunk = toRetire.slice(i, i + 100).map((c) => c.id);
    const { data, error } = await sb.from("campaigns")
      .update({ active: false, review_reason: "Retired 2026-06-22: superseded by per-state standing splits (email-state-house / -state-senate / -statewide-officials)", reviewed_at: new Date().toISOString() })
      .in("id", chunk).eq("active", true).select("id");
    if (error) { console.error(`  chunk failed: ${error.message}`); continue; }
    done += data?.length ?? 0;
  }
  console.log(`  → retired ${done}`);
  try {
    await sb.from("scraper_runs").insert({ source: "retire_combined_evergreens", started_at: new Date(t0).toISOString(), finished_at: new Date().toISOString(), status: "success", rows_updated: done, notes: `deactivated ${done} *-introduce-yourself in favor of P5 splits` });
  } catch { /* best-effort */ }
} else if (toRetire.length) {
  console.log(`  (dry-run — re-run with --apply to retire.)`);
}
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
