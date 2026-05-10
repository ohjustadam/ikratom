#!/usr/bin/env node
/**
 * Emergency correction: TN SB 1656 / HB 1649 is already law.
 * Owner discovered via the TN Capitol site that this bill:
 *   - Passed Senate 23-2 on 4/16/2026 (via companion HB 1649)
 *   - Signed by H. Speaker 4/30, Senate Speaker 5/5
 *   - Transmitted to Governor 5/6
 *   - SIGNED BY GOVERNOR 5/7/2026 — IT IS NOW LAW
 *
 * OpenStates was missing all of this (their data stopped at Apr 17
 * "Sponsor(s) Added"), so our sync never caught it, and the
 * intermediate alert I created earlier ("positioned for floor vote")
 * is now misleading.
 *
 * Reframe everything as: ALREADY ENACTED — push for repeal /
 * understand impact / educate other states.
 *
 * The campaign was already retargeted to all 132 TN state legs by
 * the trigger — that's still the correct target list (those are
 * the people who voted, and the people to lobby for repeal in next
 * session).
 */
import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const BILL_ID = "8a61cbd0-4158-4f68-a3e4-687e78877deb";
const PRIOR_ALERT_ID = "2dac7085-a21d-41cc-83a6-5ee158f2bd21"; // the misleading "floor vote" alert
const PRIOR_CAMPAIGN_ID = "587acc4e-9371-48fe-b4a3-8cb02c5460aa";

// 1. Update bill: status = enacted, signed_at = 5/7, last_action reflects reality
{
  const { error } = await sb.from("bills").update({
    status: "enacted",
    last_action: "Signed by Governor — enacted as law",
    last_action_at: "2026-05-07",
    signed_at: "2026-05-07",
    effective_date: null, // unknown until we check the bill text
    local_meta: {
      official_status: "enacted",
      summary_one_line: "TN: Matthew Davenport's Law signed by Governor 5/7/2026 — creates new criminal offenses + testing requirements for kratom",
    },
  }).eq("id", BILL_ID);
  console.log("bill update:", error?.message ?? "✓ enacted, signed 5/7/2026");
}

// 2. Update the prior misleading alert
{
  const { error } = await sb.from("policy_alerts").update({
    title: "TN SB 1656 / HB 1649 (Matthew Davenport's Law) — SIGNED INTO LAW 5/7/2026",
    severity: "critical",
    body: [
      "TN SB 1656 (companion HB 1649) was SIGNED INTO LAW by the Governor on May 7, 2026.",
      "",
      "Matthew Davenport's Law creates new criminal offenses + testing requirements related to kratom in Tennessee.",
      "",
      "Full timeline:",
      "• Apr 16 — Passed Senate 23-2 (via substituted companion HB 1649)",
      "• Apr 30 — Signed by House Speaker",
      "• May 5  — Signed by Senate Speaker",
      "• May 7  — SIGNED BY GOVERNOR — NOW LAW",
      "",
      "Our system missed every step of this because OpenStates' feed stopped at Apr 17. Action needed:",
      "1. Understand impact — TN advocates need to know what the new criminal offenses are",
      "2. Push for repeal or amendment in next legislative session",
      "3. Make sure no other state passes a similar bill without a fight",
    ].join("\n"),
    source_url: "https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=SB1656",
  }).eq("id", PRIOR_ALERT_ID);
  console.log("alert update:", error?.message ?? "✓ reframed as enacted");
}

// 3. Reframe the campaign
{
  const newSubject = "Tennessee's Matthew Davenport's Law (SB 1656 / HB 1649) — repeal or amend";
  const newBody = `Dear {{recipient_title}} {{recipient_last_name}},

I'm writing as a member of the kratom advocacy community regarding Tennessee's Matthew Davenport's Law (SB 1656 / companion HB 1649), which was signed into law on May 7, 2026.

The bill creates new criminal offenses and testing requirements related to kratom. I respectfully ask you to consider:

1. **Distinguish natural leaf from 7-hydroxymitragynine-enriched products.** The legitimate kratom industry supports restrictions on enriched and synthetic derivatives — what we oppose is broad criminalization that captures the natural plant used safely for centuries.

2. **The federal NDCS 2026 framework makes this distinction explicit.** State law that conflicts with the federal framing creates enforcement confusion and pushes consumers to unregulated sources.

3. **The Kratom Consumer Protection Act (KCPA)**, adopted in eight states, is the tested model — age limits, labeling requirements, 7-OH cap. It targets the actual concerning products without criminalizing safe use.

I ask you to support repeal or amendment of Matthew Davenport's Law in the next legislative session, in favor of the KCPA framework.

Bill text: https://wapp.capitol.tn.gov/apps/BillInfo/Default.aspx?BillNumber=SB1656
iKratom briefing: https://www.ikratom.org/briefings/ndcs-2026

Sincerely,
{{full_name}}
{{city}}, {{state}}`;

  const { error } = await sb.from("campaigns").update({
    title: "TN SB 1656 / HB 1649 — Matthew Davenport's Law just became law. Push for repeal.",
    blurb: "Tennessee signed Matthew Davenport's Law on May 7, 2026 — new kratom criminal offenses + testing. We missed it during passage; act now for repeal or amendment.",
    subject_template: newSubject,
    body_template: newBody,
  }).eq("id", PRIOR_CAMPAIGN_ID);
  console.log("campaign update:", error?.message ?? "✓ reframed as repeal");
}

// 4. Also nudge the forum thread to mention the enacted status
{
  const { data: thread } = await sb.from("bills").select("forum_thread_id").eq("id", BILL_ID).single();
  if (thread?.forum_thread_id) {
    await sb.from("forum_posts").insert({
      thread_id: thread.forum_thread_id,
      author_id: null,
      body: "⚠️ UPDATE: This bill was SIGNED INTO LAW on May 7, 2026 via companion HB 1649. Our system missed the passage because OpenStates' feed stopped tracking after Apr 17. Action goal now: understand impact + push for repeal in next session.",
    });
    console.log("forum thread updated with enacted notice");
  }
}

console.log("\n✓ All wired. URLs:");
console.log("  /pulse — should show critical");
console.log("  /campaigns/alert-tn-tn-sb-1656-matthew-davenports-law-2dac70");
console.log("  /admin/campaigns/pending — approve + edit if needed");
console.log("  /forum/TN — updated thread");
