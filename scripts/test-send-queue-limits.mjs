/**
 * test-send-queue-limits.mjs — prove the daily-cap, pause and RESUME paths.
 *
 * The happy path was proven by test-send-queue-e2e.mjs. The paths that matter
 * more are the ones a user only meets on a bad day:
 *
 *   1. the batch runs out of daily headroom mid-flight
 *   2. it PAUSES with an explanation instead of failing silently
 *   3. tomorrow it RESUMES on its own and finishes
 *
 * (3) is the one that had a real bug: the worker's pickup query originally
 * selected only ('queued','sending'), so a batch paused for "resumes
 * automatically tomorrow" would have sat there forever. That was caught by
 * reading, not by running — which is exactly why it now gets a test.
 *
 * HOW THE LIMIT IS FORCED: no code is modified and no constant is patched. The
 * worker computes remaining headroom as (effectiveDaily - sends in the last
 * 24h), so seeding synthetic campaign_actions rows shrinks the real headroom
 * and the untouched production logic does the rest. "Tomorrow" is simulated by
 * deleting those rows, which is precisely what the rolling 24h window does.
 *
 * SAFETY: every message goes to the TEST ACCOUNT'S OWN address. Never a real
 * legislator. Throwaway rows live under state code ZZ and are deleted at the
 * end, including the synthetic actions.
 *
 * Usage:
 *   node --env-file=.env.local scripts/test-send-queue-limits.mjs --send
 */
import { createClient } from "@supabase/supabase-js";

const SEND = process.argv.includes("--send");
const BASE = process.env.TEST_BASE_URL || "http://localhost:3002";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const TEST_STATE = "ZZ";
const RECIPIENTS = 3;
const HEADROOM = 2; // fits 2 of 3 → forces the split
const created = { state: null, legislators: [], campaign: null, batch: null };
const log = (s, m) => console.log(`  ${String(s).padEnd(5)} ${m}`);

async function drain() {
  const res = await fetch(`${BASE}/api/cron/drain-send-batches`, {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  return { status: res.status, body: await res.text() };
}

async function batchState() {
  const { data } = await sb.from("campaign_send_batches")
    .select("status, sent_count, failed_count, pause_reason").eq("id", created.batch).maybeSingle();
  return data;
}

async function cleanup() {
  console.log("\ncleanup:");
  if (created.batch) {
    await sb.from("campaign_send_batch_items").delete().eq("batch_id", created.batch);
    await sb.from("campaign_send_batches").delete().eq("id", created.batch);
  }
  if (created.campaign) {
    await sb.from("campaign_actions").delete().eq("campaign_id", created.campaign);
    await sb.from("campaigns").delete().eq("id", created.campaign);
  }
  for (const id of created.legislators) await sb.from("legislators").delete().eq("id", id);
  if (created.state) await sb.from("states").delete().eq("abbr", created.state);
  log("", "all test rows removed");
}

async function main() {
  console.log(`\n== send-queue LIMIT / PAUSE / RESUME — ${SEND ? "LIVE" : "DRY RUN"} ==\n`);

  const { data: prof } = await sb.from("profiles")
    .select("id, full_name").eq("email", process.env.AUDIT_TEST_EMAIL).maybeSingle();
  const { data: integ } = await sb.from("email_integrations")
    .select("provider, account_email").eq("user_id", prof.id).maybeSingle();
  const recipient = integ.account_email;
  log("user", `${prof.id} · ${integ.provider} · ${recipient}`);

  const { resolveLimits } = await import("../src/lib/email/provider-limits.ts").catch(() => ({}));
  // Recompute the gmail_free effective cap the same way the app does, without
  // importing TS into a .mjs: 500 documented * 0.85 headroom.
  const effectiveDaily = Math.floor(500 * 0.85);
  const synthetic = effectiveDaily - HEADROOM;
  log("cap", `gmail_free effective ${effectiveDaily}/day → seeding ${synthetic} prior sends, leaving ${HEADROOM}`);

  if (!SEND) { log("--", "DRY RUN — re-run with --send"); return; }

  // scaffolding
  await sb.from("states").insert({
    abbr: TEST_STATE, name: "E2E Test (delete me)", kratom_status: "legal", briefing_gen_enabled: false,
  });
  created.state = TEST_STATE;

  for (let i = 1; i <= RECIPIENTS; i++) {
    const { data: l } = await sb.from("legislators").insert({
      state: TEST_STATE, role: "state_senate", level: "state",
      full_name: `E2E Target ${i} (delete me)`, email: recipient, active: true,
    }).select("id").single();
    created.legislators.push(l.id);
  }
  const { data: camp } = await sb.from("campaigns").insert({
    slug: `e2e-limits-${Date.now()}`, title: "E2E limit test (delete me)",
    state: TEST_STATE, target_roles: ["state_senate"],
    subject_template: "iKratom limit test",
    body_template: "Dear {{legislator_role}} {{legislator_name}},\n\nLimit/pause/resume test.\n\n{{full_name}}",
    active: true, review_state: "manual", mobilization_type: "constituent",
  }).select("id").single();
  created.campaign = camp.id;
  log("setup", `${RECIPIENTS} targets + campaign ${camp.id}`);

  // Seed synthetic history so the REAL headroom maths leaves room for 2.
  const rows = Array.from({ length: synthetic }, () => ({
    user_id: prof.id, campaign_id: camp.id, legislator_id: created.legislators[0],
    method: "platform_email", subject: "synthetic", body: "synthetic",
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from("campaign_actions").insert(rows.slice(i, i + 200));
    if (error) throw new Error(`seed actions: ${error.message}`);
  }
  log("seed", `${synthetic} synthetic sends in the last 24h`);

  const { data: batch } = await sb.from("campaign_send_batches").insert({
    user_id: prof.id, campaign_id: camp.id, provider: integ.provider, provider_tier: "gmail_free",
    subject_template: "iKratom limit test",
    body_template: "Dear {{legislator_role}} {{legislator_name}},\n\nLimit/pause/resume test.\n\n{{full_name}}",
    status: "queued", total_count: RECIPIENTS,
  }).select("id").single();
  created.batch = batch.id;
  await sb.from("campaign_send_batch_items").insert(
    created.legislators.map((id) => ({ batch_id: batch.id, legislator_id: id, email: recipient })),
  );
  log("queue", `batch ${batch.id} · ${RECIPIENTS} recipients · only ${HEADROOM} can go today`);

  // ── PASS 1: should send exactly HEADROOM, leave the rest pending ─────────
  const r1 = await drain();
  const s1 = await batchState();
  log("run1", `HTTP ${r1.status} ${r1.body.slice(0, 90)}`);
  log("run1", `batch=${s1.status} sent=${s1.sent_count} failed=${s1.failed_count}`);

  // ── PASS 2: no headroom left → must PAUSE with an explanation ────────────
  const r2 = await drain();
  const s2 = await batchState();
  log("run2", `batch=${s2.status} sent=${s2.sent_count}`);
  log("run2", `pause_reason: ${s2.pause_reason ?? "(none)"}`);

  // ── SIMULATE TOMORROW: the rolling window drops the synthetic history ────
  await sb.from("campaign_actions").delete()
    .eq("campaign_id", camp.id).eq("subject", "synthetic");
  log("day2", "synthetic history cleared — headroom restored");

  const notifBefore = await sb.from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", prof.id).eq("kind", "campaign_send_batch");

  // ── PASS 3: must RESUME on its own and finish ────────────────────────────
  const r3 = await drain();
  const s3 = await batchState();
  log("run3", `HTTP ${r3.status} ${r3.body.slice(0, 90)}`);
  log("run3", `batch=${s3.status} sent=${s3.sent_count} failed=${s3.failed_count}`);

  const notifAfter = await sb.from("notifications")
    .select("title", { count: "exact" })
    .eq("user_id", prof.id).eq("kind", "campaign_send_batch")
    .order("created_at", { ascending: false }).limit(3);

  console.log("\nASSERTIONS");
  const a1 = s1.sent_count === HEADROOM;
  const a2 = s2.status === "paused" && !!s2.pause_reason;
  const a3 = s3.status === "complete" && s3.sent_count === RECIPIENTS;
  const a4 = (notifAfter.count ?? 0) > (notifBefore.count ?? 0);
  log(a1 ? "PASS" : "FAIL", `pass 1 stopped at the daily headroom (${s1.sent_count}/${HEADROOM})`);
  log(a2 ? "PASS" : "FAIL", `paused with a reason, not a silent stall`);
  log(a3 ? "PASS" : "FAIL", `resumed unaided and completed (${s3.sent_count}/${RECIPIENTS})`);
  log(a4 ? "PASS" : "FAIL", `user was notified (${notifAfter.data?.[0]?.title ?? "none"})`);

  console.log(`\n${a1 && a2 && a3 && a4 ? "ALL PASS" : "FAILURES ABOVE"}`);
  await cleanup();
}

main().catch(async (e) => {
  console.error("\nFAILED:", e.message);
  await cleanup();
  process.exit(1);
});
