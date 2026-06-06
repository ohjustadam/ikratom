#!/usr/bin/env node
/**
 * audit-auto-campaigns.mjs — find auto-generated campaigns that should never
 * have been campaigns: ones spawned from INFORMATIONAL alerts (product recalls,
 * FDA/DEA actions, court rulings, breaking news) rather than true legislative
 * actions. Mirrors the 0178 trigger gate (only bill_event + bop_hearing).
 *
 *   node --env-file=.env.local scripts/audit-auto-campaigns.mjs          # dry-run (read-only)
 *   node --env-file=.env.local scripts/audit-auto-campaigns.mjs --apply  # retire bad live ones (active=false)
 */
import { createClient } from "@supabase/supabase-js";
import { isCampaignWorthyAlert } from "./lib/campaign-eligibility.mjs";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const { data: campaigns, error } = await sb
  .from("campaigns")
  .select("id, slug, title, active")
  .eq("auto_generated", true);
if (error) { console.error(error.message); process.exit(1); }
const list = campaigns ?? [];
console.log(`Auditing ${list.length} auto-generated campaigns${APPLY ? " [APPLY]" : " [dry-run]"}…\n`);

// Source alert kind via policy_alerts.campaign_id = campaign.id.
const ids = list.map((c) => c.id);
const srcByCampaign = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const { data: alerts } = await sb
    .from("policy_alerts")
    .select("campaign_id, kind, title")
    .in("campaign_id", ids.slice(i, i + 200));
  for (const a of alerts ?? []) if (a.campaign_id) srcByCampaign.set(a.campaign_id, { kind: a.kind, title: a.title });
}

const bad = [];       // source alert isn't campaign-worthy (recall/lawsuit/news)
const unlinked = [];  // no source alert → can't determine
for (const c of list) {
  const src = srcByCampaign.get(c.id);
  if (!src) { unlinked.push(c); continue; }
  if (!isCampaignWorthyAlert(src.kind, src.title)) bad.push({ c, kind: src.kind });
}

console.log(`❌ NON-ACTIONABLE source (recall / FDA / DEA / court / news) — ${bad.length}`);
for (const { c, kind } of bad) {
  console.log(`  ${c.active ? "LIVE " : "off  "} ${String(kind).padEnd(12)} ${c.slug.slice(0, 48)}  ${(c.title ?? "").slice(0, 46)}`);
}
console.log(`\n· UNLINKED (no source alert, left as-is) — ${unlinked.length}`);

const toRetire = bad.filter((x) => x.c.active).map((x) => x.c.id);
if (APPLY && toRetire.length) {
  const { error: upErr, count } = await sb
    .from("campaigns")
    .update({ active: false })
    .in("id", toRetire)
    .select("id", { count: "exact" });
  if (upErr) console.error(`\nApply failed: ${upErr.message}`);
  else console.log(`\n✅ Retired ${count ?? toRetire.length} non-actionable auto-campaign(s) (active=false).`);
  try {
    await sb.from("scraper_runs").insert({
      source: "audit_auto_campaigns",
      started_at: new Date(Date.now() - 1000).toISOString(),
      finished_at: new Date().toISOString(),
      status: "success",
      rows_updated: count ?? toRetire.length,
      notes: `${bad.length} non-actionable auto-campaigns; ${toRetire.length} were live and retired`,
    });
  } catch { /* best-effort */ }
} else if (toRetire.length) {
  console.log(`\n(dry-run — ${toRetire.length} LIVE non-actionable campaign(s) would be retired. Re-run with --apply.)`);
}
process.exit(0);
