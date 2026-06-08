#!/usr/bin/env node
/**
 * audit-alert-localities.mjs — find published alerts whose STATE is wrong.
 *
 * The news→alert classifier used to trust the AI's free-text "locality" with no
 * cross-check, so it published wrong-state alerts (an Illinois town ordinance
 * labeled "Rhode Island"). This audits APPROVED, state-specific alerts: it
 * reconciles each alert's stored state against the SOURCE article text (the
 * linked news_items — NOT the AI-written alert body, which contains the same
 * hallucination) and flags mismatches / uncorroborated states.
 *
 *   node --env-file=.env.local scripts/audit-alert-localities.mjs           # dry-run (read-only report)
 *   node --env-file=.env.local scripts/audit-alert-localities.mjs --apply   # set flagged alerts → pending (unpublish for review)
 *   node --env-file=.env.local scripts/audit-alert-localities.mjs --limit 500
 */
import { createClient } from "@supabase/supabase-js";
import { reconcileLocality, STATE_ABBRS } from "./lib/geo-resolver.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const APPLY = args.includes("--apply");
const LIMIT = parseInt(arg("--limit") ?? "1000");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const { data: alerts, error } = await sb
  .from("policy_alerts")
  .select("id, title, locality, moderation_status, created_at")
  .eq("moderation_status", "approved")
  .order("created_at", { ascending: false })
  .limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }

const specific = (alerts ?? []).filter((a) => STATE_ABBRS.has(String(a.locality ?? "").toUpperCase()));
console.log(`Auditing ${specific.length} approved state-specific alerts${APPLY ? " [APPLY]" : " [dry-run]"}…\n`);

const mismatches = [];     // source names a DIFFERENT state than stored
const uncorroborated = []; // source doesn't confirm the stored state
const unverifiable = [];    // no linked news source → can't check

for (const a of specific) {
  const { data: news } = await sb
    .from("news_items")
    .select("title, summary, state")
    .eq("policy_alert_id", a.id)
    .limit(10);
  const srcText = (news ?? []).map((n) => `${n.title ?? ""} ${n.summary ?? ""}`).join(" ").trim();
  const scopeState = (news ?? []).map((n) => n.state).find((s) => STATE_ABBRS.has(String(s ?? "").toUpperCase())) ?? null;

  if (!srcText && !scopeState) { unverifiable.push(a); continue; }

  const stored = String(a.locality).toUpperCase();
  const { locality: derived, corroborated } = reconcileLocality({ aiLocality: stored, scopeState, text: srcText });

  if (corroborated && derived === stored) continue; // clean
  if (corroborated && derived !== stored) mismatches.push({ a, derived });
  else uncorroborated.push({ a, derived });
}

const line = (a, extra = "") =>
  console.log(`  ${String(a.locality).padEnd(4)} ${a.id.slice(0, 8)}  ${(a.title ?? "").slice(0, 68)}${extra}`);

console.log(`❌ WRONG STATE (source names a different state) — ${mismatches.length}`);
for (const { a, derived } of mismatches) line(a, `  → should be ${derived}`);
console.log(`\n⚠ UNCORROBORATED (source doesn't confirm the state) — ${uncorroborated.length}`);
for (const { a } of uncorroborated) line(a);
console.log(`\n· UNVERIFIABLE (no linked news source, left as-is) — ${unverifiable.length}`);

const toHold = [...mismatches, ...uncorroborated].map((x) => x.a.id);
if (APPLY && toHold.length) {
  const { error: upErr, count } = await sb
    .from("policy_alerts")
    .update({ moderation_status: "pending" })
    .in("id", toHold)
    .select("id", { count: "exact" });
  if (upErr) console.error(`\nApply failed: ${upErr.message}`);
  else console.log(`\n✅ Set ${count ?? toHold.length} flagged alert(s) → pending (unpublished for review).`);
  // Telemetry only on a real run (keeps the dry-run purely read-only).
  try {
    await sb.from("scraper_runs").insert({
      source: "audit_alert_localities",
      started_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      status: "success",
      rows_updated: count ?? toHold.length,
      notes: `${mismatches.length} wrong-state, ${uncorroborated.length} uncorroborated held; ${unverifiable.length} unverifiable`,
    });
  } catch { /* best-effort */ }
} else if (toHold.length) {
  console.log(`\n(dry-run — ${toHold.length} alert(s) would be set to pending. Re-run with --apply once reviewed.)`);
}
process.exit(0);
