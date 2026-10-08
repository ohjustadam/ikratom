/**
 * test-send-queue-e2e.mjs — prove the durable send queue actually sends.
 *
 * WHY THIS EXISTS: the queue (mig 0248 + /api/cron/drain-send-batches) was
 * built, typechecked and unit-tested, but no message had ever left a real
 * mailbox through it. This session has repeatedly found code that LOOKED
 * correct and was not — a mailto that silently truncated at 386% of the URL
 * limit, a 20-target cap that reported success while sending 20 of 198, a
 * paused batch that could never resume. "It compiles" is not evidence.
 *
 * ── SAFETY: WHO THIS EMAILS ───────────────────────────────────────────────
 * It emails the TEST ACCOUNT'S OWN ADDRESS and nobody else. It never touches a
 * real legislator, a real campaign, or a real user. Sending test mail to
 * government offices would be spam, and no amount of "it's only a test" makes
 * that acceptable.
 *
 * It creates a throwaway legislator + campaign under a NON-EXISTENT state code
 * (ZZ) so it cannot collide with, or surface on, any real state page, then
 * deletes both. --keep skips cleanup for inspection.
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-send-queue-e2e.mjs            # dry run
 *   node --env-file=.env.local scripts/test-send-queue-e2e.mjs --send     # really sends
 *   node --env-file=.env.local scripts/test-send-queue-e2e.mjs --send --keep
 */
import { createClient } from "@supabase/supabase-js";

const SEND = process.argv.includes("--send");
const KEEP = process.argv.includes("--keep");
const BASE = process.env.TEST_BASE_URL || "http://localhost:3002";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TEST_STATE = "ZZ"; // not a US state — cannot appear on a real state page
const created = { state: null, legislator: null, campaign: null, batch: null };

function log(step, msg) { console.log(`  ${step.padEnd(4)} ${msg}`); }

async function cleanup() {
  if (KEEP) { console.log("\n--keep: leaving test rows in place."); return; }
  console.log("\ncleanup:");
  if (created.batch) {
    await sb.from("campaign_send_batch_items").delete().eq("batch_id", created.batch);
    await sb.from("campaign_send_batches").delete().eq("id", created.batch);
    log("", "batch + items deleted");
  }
  if (created.campaign) {
    await sb.from("campaign_actions").delete().eq("campaign_id", created.campaign);
    await sb.from("campaigns").delete().eq("id", created.campaign);
    log("", "campaign + actions deleted");
  }
  if (created.legislator) {
    await sb.from("legislators").delete().eq("id", created.legislator);
    log("", "legislator deleted");
  }
  // Last: the state row the legislator FK pointed at.
  if (created.state) {
    await sb.from("states").delete().eq("abbr", created.state);
    log("", "test state deleted");
  }
}

async function main() {
  console.log(`\n== send-queue E2E — ${SEND ? "LIVE SEND" : "DRY RUN"} ==\n`);

  // 1. the test user + their connected mailbox
  const email = process.env.AUDIT_TEST_EMAIL;
  if (!email) throw new Error("AUDIT_TEST_EMAIL not set");
  const { data: prof } = await sb.from("profiles")
    .select("id, full_name, state, is_admin, is_owner").eq("email", email).maybeSingle();
  if (!prof) throw new Error(`no profile for ${email}`);
  log("1", `test user ${prof.id} (admin=${prof.is_admin} owner=${prof.is_owner})`);

  const { data: integ } = await sb.from("email_integrations")
    .select("provider, account_email").eq("user_id", prof.id).maybeSingle();
  if (!integ) throw new Error("test account has no connected mailbox");
  log("1", `mailbox ${integ.provider} ${integ.account_email}`);

  // THE ONLY RECIPIENT. Their own address.
  const recipient = integ.account_email;

  // 2. throwaway target.
  // legislators.state is a FK to states.abbr, so the state row must exist
  // first. briefing_gen_enabled:false keeps the nightly 50-state briefing
  // generator from picking up a fake state and burning AI budget on it.
  const { error: stErr } = await sb.from("states").insert({
    abbr: TEST_STATE, name: "E2E Test (delete me)", kratom_status: "legal",
    briefing_gen_enabled: false,
  });
  if (stErr && !String(stErr.message).includes("duplicate")) {
    throw new Error(`state insert: ${stErr.message}`);
  }
  created.state = TEST_STATE;
  log("2", `test state ${TEST_STATE} created`);

  const { data: leg, error: legErr } = await sb.from("legislators").insert({
    state: TEST_STATE, role: "state_senate", level: "state",
    full_name: "E2E Test Target (delete me)", email: recipient, active: true,
  }).select("id").single();
  if (legErr) throw new Error(`legislator insert: ${legErr.message}`);
  created.legislator = leg.id;
  log("2", `target ${leg.id} -> ${recipient}`);

  // 3. throwaway campaign scoped to that state
  const slug = `e2e-send-queue-${Date.now()}`;
  const { data: camp, error: campErr } = await sb.from("campaigns").insert({
    slug, title: "E2E send-queue test (delete me)",
    state: TEST_STATE, target_roles: ["state_senate"],
    subject_template: "iKratom send-queue test",
    body_template: [
      "Dear {{legislator_role}} {{legislator_name}},",
      "",
      "This is an automated end-to-end test of the iKratom durable send queue.",
      "If you are reading this in a real inbox that is not the test account, something is wrong.",
      "",
      "{{full_name}}",
    ].join("\n"),
    active: true, review_state: "manual", mobilization_type: "constituent",
  }).select("id").single();
  if (campErr) throw new Error(`campaign insert: ${campErr.message}`);
  created.campaign = camp.id;
  log("3", `campaign ${camp.id} (${slug})`);

  if (!SEND) {
    log("--", "DRY RUN — no batch queued, no mail sent. Re-run with --send.");
    await cleanup();
    return;
  }

  // 4. queue exactly as enqueueCampaignSend would
  const { data: batch, error: bErr } = await sb.from("campaign_send_batches").insert({
    user_id: prof.id, campaign_id: camp.id,
    provider: integ.provider, provider_tier: "gmail_free",
    subject_template: "iKratom send-queue test",
    body_template: "Dear {{legislator_role}} {{legislator_name}},\n\nE2E test of the durable send queue.\n\n{{full_name}}",
    status: "queued", total_count: 1,
  }).select("id").single();
  if (bErr) throw new Error(`batch insert: ${bErr.message}`);
  created.batch = batch.id;
  await sb.from("campaign_send_batch_items").insert({
    batch_id: batch.id, legislator_id: leg.id, email: recipient,
  });
  log("4", `batch ${batch.id} queued with 1 recipient`);

  // 5. drive the real worker over HTTP
  const secret = process.env.CRON_SECRET;
  const res = await fetch(`${BASE}/api/cron/drain-send-batches`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  const body = await res.text();
  log("5", `worker HTTP ${res.status}: ${body.slice(0, 200)}`);

  // 6. what actually happened
  const { data: items } = await sb.from("campaign_send_batch_items")
    .select("status, attempts, error, sent_at").eq("batch_id", batch.id);
  const { data: after } = await sb.from("campaign_send_batches")
    .select("status, sent_count, failed_count, pause_reason").eq("id", batch.id).maybeSingle();
  const { data: actions } = await sb.from("campaign_actions")
    .select("id, method").eq("campaign_id", camp.id);
  const { data: notifs } = await sb.from("notifications")
    .select("kind, title").eq("user_id", prof.id).eq("kind", "campaign_send_batch")
    .order("created_at", { ascending: false }).limit(1);

  console.log("\nRESULT");
  log("item", `${items?.[0]?.status} attempts=${items?.[0]?.attempts} err=${items?.[0]?.error ?? "none"}`);
  log("batch", `${after?.status} sent=${after?.sent_count} failed=${after?.failed_count} pause=${after?.pause_reason ?? "none"}`);
  log("log", `campaign_actions rows: ${actions?.length ?? 0} (${actions?.[0]?.method ?? "-"})`);
  log("notif", notifs?.length ? `"${notifs[0].title}"` : "none");

  const pass =
    items?.[0]?.status === "sent" &&
    after?.status === "complete" &&
    (actions?.length ?? 0) === 1 &&
    (notifs?.length ?? 0) === 1;
  console.log(`\n${pass ? "PASS" : "FAIL"} — mail ${pass ? "delivered to" : "NOT confirmed for"} ${recipient}`);

  await cleanup();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  await cleanup();
  process.exit(1);
});
