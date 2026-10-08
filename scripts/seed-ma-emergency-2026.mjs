/**
 * seed-ma-emergency-2026.mjs — the Massachusetts Schedule I emergency response.
 *
 * WHAT HAPPENED (verified against primary sources on 2026-08-20):
 *   2026-08-10  S 3198 "An Act relative to the regulation of Kratom" reported
 *               favorably from the Senate committee on Public Health. Its own
 *               history reads "New draft of S1609" — which is exactly why our
 *               LegiScan sync never picked it up: it does not follow new-draft
 *               redirects. Source: malegislature.gov/Bills/194/S3198
 *   2026-08-13  DPH Commissioner Dr. Robbie Goldstein, under Gov. Maura Healey,
 *               signed an emergency order under M.G.L. c. 94C s.2A placing ALL
 *               forms of kratom into Schedule I.
 *   2026-08-28  Order takes effect after the 14-day notice period. Possession,
 *               distribution and sale become illegal; local boards of health may
 *               issue cease-and-desist notices, citations, and pull licences.
 *   2027-08-28  Order expires (one-year statutory maximum).
 *
 * The scope point that matters to a legislator: the federal DEA action targets
 * CONCENTRATED 7-OH above defined thresholds. Massachusetts scheduled every
 * form, including natural leaf. That distinction is the entire argument.
 *
 * WHAT THIS DOES (idempotent — safe to re-run):
 *   1. Upserts bill S 3198, closing the sync gap.
 *   2. Creates ONE time-boxed emergency campaign. It deliberately does NOT touch
 *      the three standing MA campaigns from 2026-06-22 — those are evergreen by
 *      design ("always available") and rewriting them would destroy that.
 *   3. Creates ONE critical policy_alert linked to that campaign.
 *   4. Supersedes the 3 unapproved auto-generated MA campaigns clogging review.
 *
 * IT SENDS NOTHING. The alert is written with auto_pushed_at PRE-STAMPED so the
 * hourly push_critical_alerts cron will skip it. Sending is a separate, deliberate
 * step: --notify clears that stamp and lets the next cron deliver it.
 *
 * Usage:
 *   node --env-file=.env.local scripts/seed-ma-emergency-2026.mjs            # dry run
 *   node --env-file=.env.local scripts/seed-ma-emergency-2026.mjs --apply
 *   node --env-file=.env.local scripts/seed-ma-emergency-2026.mjs --notify   # arm the push
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const NOTIFY = process.argv.includes("--notify");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const CAMPAIGN_SLUG = "ma-emergency-schedule-i-2026";
const DEDUPE = "ma-dph-schedule-i-order-2026-08-13";
const ORDER_URL = "https://www.mass.gov/kratom";
const BILL_URL = "https://malegislature.gov/Bills/194/S3198";

const SUBJECT = "Urgent: the DPH kratom order takes effect August 28 - please act";

const BODY = [
  // Placeholders MUST come from TemplateVars in src/modules/campaigns/templates.ts:
  // full_name, street, city, state, zip, legislator_name, legislator_role,
  // representatives. renderTemplate leaves UNKNOWN vars as-is, so a stray
  // {{recipient_title}} would mail 198 legislators a literal "Dear
  // {{recipient_title}}". legislator_role resolves via ROLE_SHORT -> "State Sen."
  // {{street}} always renders empty by privacy policy and its line is dropped.
  "Dear {{legislator_role}} {{legislator_name}},",
  "",
  "My name is {{full_name}} and I am a constituent in {{city}}, {{state}} {{zip}}.",
  "",
  "On August 13, the Commissioner of the Department of Public Health signed an emergency order under M.G.L. c. 94C s.2A placing every form of kratom into Schedule I. It takes effect on August 28. From that date, possession, distribution and sale become criminal offenses, and local boards of health may pull licences from lawful businesses.",
  "",
  "I am asking you to act before August 28.",
  "",
  "Three days before that order was signed, on August 10, the Senate committee on Public Health reported S 3198, \"An Act relative to the regulation of Kratom,\" favorably. The legislature was already advancing a regulatory framework. The order replaced that work with prohibition before it could be debated.",
  "",
  "Two facts I would ask you to weigh:",
  "",
  "1. Scope. The federal DEA action targets CONCENTRATED 7-hydroxymitragynine above defined thresholds. The Massachusetts order covers all forms, including natural leaf, which contains only trace 7-OH. A measure aimed at concentrated synthetic derivatives has been applied to the whole plant.",
  "",
  "2. Effect. Prohibition removes the regulated, tested, labeled supply and leaves the unregulated one in place. Adults who currently buy a labeled product from a licensed retailer will not stop; they will buy something nobody is testing.",
  "",
  "I respectfully ask you to:",
  "",
  "- Advance S 3198 and enact a regulatory framework - age limits, testing, labeling, and limits on concentrated 7-OH - instead of prohibition.",
  "- Ask the Department of Public Health to narrow the order to concentrated and synthetic 7-OH products rather than natural leaf.",
  "- Speak with constituents who use kratom before the order takes effect on August 28.",
  "",
  "I am glad to share my own experience if that would be useful.",
  "",
  "Thank you for your time and your service to Massachusetts.",
  "",
  "Sincerely,",
  "{{full_name}}",
  "{{street}}",
  "{{city}}, {{state}} {{zip}}",
].join("\n");

const ALERT_TITLE = "EMERGENCY: Massachusetts bans all kratom August 28 - act now";
const ALERT_BODY = [
  "Massachusetts DPH Commissioner Dr. Robbie Goldstein signed an emergency order on August 13 placing every form of kratom - including natural leaf - into Schedule I under M.G.L. c. 94C s.2A.",
  "",
  "It takes effect August 28, 2026. Possession, distribution and sale become illegal. Local boards of health can issue cease-and-desist notices, citations, and suspend licences. The order can stand for one year, until August 28, 2027.",
  "",
  "Three days before it was signed, the Senate committee on Public Health reported S 3198 - a kratom REGULATION bill - favorably. The order pre-empted it.",
  "",
  "The federal DEA action targets concentrated 7-OH above thresholds. Massachusetts scheduled the entire plant.",
  "",
  "If you live in Massachusetts, emailing your legislators takes one click. There are eight days.",
].join("\n");

async function main() {
  const mode = NOTIFY ? "NOTIFY" : APPLY ? "APPLY" : "DRY RUN";
  console.log(`\n== MA emergency seed - ${mode} ==\n`);

  if (NOTIFY) {
    const { data, error } = await sb
      .from("policy_alerts")
      .update({ auto_pushed_at: null, auto_pushed_count: 0 })
      .eq("dedupe_key", DEDUPE)
      .select("id,title");
    if (error) throw error;
    console.log(
      data?.length
        ? `Armed ${data.length} alert(s) for the next push cron:\n  ${data[0].title}`
        : "No alert found - run --apply first.",
    );
    return;
  }

  // 1. S 3198 - closes the new-draft sync gap
  console.log("1. BILL  S 3198 - An Act relative to the regulation of Kratom");
  let billId = null;
  const { data: existing } = await sb
    .from("bills").select("id").eq("state", "MA").eq("bill_number", "S 3198").maybeSingle();
  if (existing) {
    billId = existing.id;
    console.log("   already present:", billId);
  } else if (APPLY) {
    const { data, error } = await sb.from("bills").insert({
      state: "MA", bill_number: "S 3198", session_id: "194",
      title: "An Act relative to the regulation of Kratom",
      status: "committee", scope: "state",
      last_action: "Reported favorably by committee (new draft of S1609); referred to committee",
      last_action_at: "2026-08-10",
      official_url: BILL_URL, source_url: BILL_URL,
      targets_natural_leaf: false, targets_synthetic_only: false,
      kratom_relevance: "high", active: true,
      last_synced_at: new Date().toISOString(),
    }).select("id").single();
    if (error) throw error;
    billId = data.id;
    console.log("   inserted:", billId);
  } else {
    console.log("   would insert");
  }

  // 1b. Clear the topic-cluster lane BEFORE inserting.
  // ux_campaigns_topic_key_live allows one live campaign per topic_key, and a
  // trigger derives topic_key from (state, title) — so "…kratom ban" lands on
  // MA|kratom|ban, already held by a 2026-06-10 auto-campaign about a *delayed
  // synthetic* ban in Springfield. A statewide Schedule I order supersedes that
  // by any reading. Scoped deliberately: only auto-generated campaigns, only the
  // colliding key, never the three standing 2026-06-22 manual campaigns.
  console.log("\n1b. CLEAR topic lane MA|kratom|ban (auto-generated only)");
  const { data: clash } = await sb
    .from("campaigns").select("id,slug,title,review_state")
    .eq("state", "MA").eq("auto_generated", true).eq("topic_key", "MA|kratom|ban")
    .in("review_state", ["pending_review", "auto_active", "manual"]);
  console.log(`   ${clash?.length ?? 0} holding the lane`);
  for (const c of clash ?? []) {
    console.log(`    - [${c.review_state}] ${c.title.slice(0, 62)}`);
    if (APPLY) {
      const { error } = await sb.from("campaigns")
        .update({ review_state: "superseded", active: false }).eq("id", c.id);
      if (error) throw error;
    }
  }

  // 2. the emergency campaign
  console.log("\n2. CAMPAIGN", CAMPAIGN_SLUG);
  const { data: cExist } = await sb
    .from("campaigns").select("id").eq("slug", CAMPAIGN_SLUG).maybeSingle();
  let campaignId = cExist?.id ?? null;
  if (cExist) {
    console.log("   already present:", campaignId);
    // Always refresh the templates — this script is the source of truth for the
    // wording, so a re-run after an edit must propagate rather than silently skip.
    if (APPLY) {
      const { error } = await sb.from("campaigns")
        .update({ subject_template: SUBJECT, body_template: BODY })
        .eq("id", campaignId);
      if (error) throw error;
      console.log("   templates refreshed");
    } else {
      console.log("   would refresh templates");
    }
  } else if (APPLY) {
    const { data, error } = await sb.from("campaigns").insert({
      slug: CAMPAIGN_SLUG,
      title: "EMERGENCY: Stop the Massachusetts kratom ban",
      blurb: "Massachusetts placed all kratom in Schedule I effective August 28. Email your state legislators in one click and ask them to advance S 3198 instead.",
      state: "MA", bill_id: billId,
      target_roles: ["state_senate", "state_house"],
      subject_template: SUBJECT, body_template: BODY,
      active: true, review_state: "manual", mobilization_type: "constituent",
      auto_generated: false, is_standing: false, allow_non_residents: true,
      starts_at: new Date().toISOString(), ends_at: "2026-09-30T23:59:59Z",
    }).select("id").single();
    if (error) throw error;
    campaignId = data.id;
    console.log("   inserted:", campaignId);
  } else {
    console.log("   would insert - targets state_senate + state_house, 198 MA legislators");
  }

  // 3. the alert, deliberately push-suppressed
  console.log("\n3. ALERT ", ALERT_TITLE);
  const { data: aExist } = await sb
    .from("policy_alerts").select("id").eq("dedupe_key", DEDUPE).maybeSingle();
  if (aExist) {
    console.log("   already present:", aExist.id);
  } else if (APPLY) {
    const { error } = await sb.from("policy_alerts").insert({
      kind: "bill_event", severity: "critical",
      title: ALERT_TITLE, body: ALERT_BODY,
      locality: "MA", source_url: ORDER_URL,
      bill_id: billId, campaign_id: campaignId,
      action_required: true, moderation_status: "approved",
      dedupe_key: DEDUPE,
      occurs_at: "2026-08-28T04:00:00Z", expires_at: "2026-09-30T23:59:59Z",
      auto_pushed_at: new Date().toISOString(), auto_pushed_count: 0,
    });
    if (error) throw error;
    console.log("   inserted - push SUPPRESSED until --notify");
  } else {
    console.log("   would insert - push suppressed until --notify");
  }

  // 4. clear the junk auto-campaigns out of the review queue
  console.log("\n4. SUPERSEDE unapproved auto-generated MA campaigns");
  const { data: pend } = await sb
    .from("campaigns").select("id,slug")
    .eq("state", "MA").eq("auto_generated", true).eq("review_state", "pending_review");
  console.log(`   ${pend?.length ?? 0} pending`);
  for (const p of pend ?? []) {
    console.log("    -", p.slug.slice(0, 66));
    if (APPLY) {
      await sb.from("campaigns")
        .update({ review_state: "superseded", active: false, superseded_by: campaignId })
        .eq("id", p.id);
    }
  }

  console.log(APPLY ? "\nDone. Nothing was sent. Review, then --notify.\n" : "\nDRY RUN - nothing changed.\n");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
