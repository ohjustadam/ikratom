#!/usr/bin/env node
/**
 * One-off: bring TN SB 1656 ("Matthew Davenport's Law") up to date
 * after we discovered the sync was missing critical action history.
 *
 * - Patches last_action / last_action_at / status to reflect the real
 *   April 16 event (companion House bill substituted = positioned for
 *   Senate floor vote)
 * - Creates a critical-severity policy_alert so /pulse picks it up
 *   AND the Phase 4 trigger auto-spawns a solidarity campaign
 *
 * Safe to re-run — alert insert is logged but won't dedupe; for that
 * the user can manually delete + retry.
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const BILL_ID = "8a61cbd0-4158-4f68-a3e4-687e78877deb";

// 1. Correct the bill's last_action to reflect the real critical event
const { error: bErr } = await sb.from("bills").update({
  last_action: "Companion House Bill substituted; positioned for Senate floor vote",
  last_action_at: "2026-04-16",
  status: "in_committee",
}).eq("id", BILL_ID);
console.log("bill update:", bErr?.message ?? "✓");

// 2. Create the critical-severity policy_alert so /pulse + trigger fire
const { data: alert, error: aErr } = await sb.from("policy_alerts").insert({
  kind: "bill_event",
  severity: "critical",
  title: "TN SB 1656 (Matthew Davenport's Law) — positioned for Senate floor vote",
  body: [
    "TN SB 1656 creates new criminal offenses + testing requirements for kratom.",
    "",
    "Timeline:",
    "• Mar 25 — Recommended for passage by Senate Judiciary Committee",
    "• Apr 8  — Recommended for passage by Senate Finance, Ways & Means Committee",
    "• Apr 16 — Companion House bill substituted (standard TN procedure that positions a bill for a Senate floor vote)",
    "",
    "Action needed. The bill is one floor vote away from passing the Senate.",
  ].join("\n"),
  locality: "TN",
  source_url: "https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=SB1656",
  bill_id: BILL_ID,
  action_required: true,
  moderation_status: "approved",
}).select("id, campaign_id").single();

if (aErr) {
  console.log("alert insert FAILED:", aErr.message);
  process.exit(1);
}
console.log("✓ alert created:", alert.id);
console.log("✓ Phase 4 trigger spawned campaign:", alert.campaign_id ?? "(none — check trigger logs)");
