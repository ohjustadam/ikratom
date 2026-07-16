#!/usr/bin/env node
/**
 * Smoke test for migration 0068 — verifies that inserting a
 * policy_alert with action_required=true + moderation_status=approved
 * causes the Postgres trigger to populate campaign_id automatically.
 *
 * Cleans up after itself: deletes the test alert + the auto-generated
 * campaign at the end. Intended to run against staging or prod after
 * a migration deploy.
 *
 * Run:
 *   node --env-file=.env.local scripts/test-auto-campaign-trigger.mjs
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TEST_TITLE = `__TEST__ Springfield, IL — city ordinance bans 7-OH ${Date.now()}`;

async function main() {
  console.log("Inserting test policy_alert…");
  const { data: alert, error: insErr } = await sb
    .from("policy_alerts")
    .insert({
      kind: "bill_event",
      severity: "watch",
      title: TEST_TITLE,
      body: "This is a test row for the auto-campaign trigger smoke test. It will be deleted.",
      locality: "IL",
      source_url: "https://example.com/test",
      action_required: true,
      moderation_status: "approved",
    })
    .select("id, campaign_id")
    .single();
  if (insErr) {
    console.error("✗ insert failed:", insErr.message);
    process.exit(1);
  }
  console.log(`  alert.id=${alert.id.slice(0, 8)}  campaign_id=${alert.campaign_id ?? "(null)"}`);

  if (!alert.campaign_id) {
    console.error("✗ trigger did NOT set campaign_id. Check Postgres logs for warnings.");
    // Clean up the alert
    await sb.from("policy_alerts").delete().eq("id", alert.id);
    process.exit(2);
  }

  console.log(`✓ trigger fired — campaign created: ${alert.campaign_id.slice(0, 8)}`);

  // Read back the campaign to verify content
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, slug, title, subject_template, target_legislator_ids, target_roles, mobilization_type, auto_generated, review_state, active")
    .eq("id", alert.campaign_id)
    .single();
  if (!campaign) {
    console.error("✗ campaign was not created despite link");
    process.exit(3);
  }
  console.log(`  slug:           ${campaign.slug}`);
  console.log(`  title:          ${campaign.title.slice(0, 70)}…`);
  console.log(`  subject:        ${campaign.subject_template.slice(0, 70)}…`);
  console.log(`  targets:        ${campaign.target_legislator_ids?.length ?? 0} legislator(s)`);
  console.log(`  roles:          ${(campaign.target_roles ?? []).join(", ")}`);
  console.log(`  mobilization:   ${campaign.mobilization_type}`);
  console.log(`  auto_generated: ${campaign.auto_generated}`);
  console.log(`  review_state:   ${campaign.review_state}`);
  console.log(`  active:         ${campaign.active}  (should be false until admin approves)`);

  // Cleanup
  console.log("\nCleaning up test rows…");
  // Unlink first to avoid FK issues if campaign delete cascades
  await sb.from("policy_alerts").update({ campaign_id: null }).eq("id", alert.id);
  await sb.from("campaigns").delete().eq("id", alert.campaign_id);
  await sb.from("policy_alerts").delete().eq("id", alert.id);
  console.log("✓ test rows deleted");
  console.log("\n✅ smoke test PASSED");
}

main().catch((e) => {
  console.error("✗ unexpected error:", e?.message ?? e);
  process.exit(99);
});
