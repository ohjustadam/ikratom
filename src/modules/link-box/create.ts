import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicHandle } from "@/lib/public-handle";
import { draftWorthy, statesInText, type LinkReading } from "@/lib/link-box";
import { buildCampaign, type Bill } from "@/modules/campaigns/auto-create";
import type { Inspected } from "./inspect";
import type { FullBill } from "./lookup";

/**
 * Add a genuinely NEW link (the duplicate check already said no match):
 *   1. a pending intel tip in the existing queue (/admin/intel-queue), written
 *      with the member's own client so RLS proves it is theirs;
 *   2. only when the link is about a live state bill that would restrict
 *      kratom and has no campaign yet, a campaign DRAFT in the existing review
 *      queue (/admin/campaigns/pending): active = false, hold_for_person =
 *      true, so no automatic approver can publish it (migration 0335).
 * The tip never asks for a campaign itself (action_required = false): the
 * moderator ticks that box if they agree, so a member's link can't start one
 * through the alert trigger unseen.
 */
export type Added = { tipId: string; draft: boolean; draftReason: string | null };

export async function addNewLink(args: {
  userClient: SupabaseClient;
  userId: string;
  profile: { username: string | null; state: string | null };
  ins: Inspected;
  reading: LinkReading;
  bill: FullBill | null;
}): Promise<{ ok: true; added: Added } | { ok: false; error: string }> {
  const { userClient, userId, profile, ins, reading, bill } = args;
  const host = hostOf(ins.publisherUrl);
  const title = ((ins.meta.title ?? "").length >= 10 ? ins.meta.title! : `A link shared from ${host}`).slice(0, 200);
  const named = statesInText(`${ins.meta.title ?? ""} ${ins.meta.description ?? ""}`);
  const locality = reading.locality ?? bill?.state ?? (named.length === 1 ? named[0] : null) ?? profile.state ?? "ALL";

  const gate = bill ? draftWorthy(bill) : null;
  const note =
    `Link box. AI reading: kind ${reading.kind}, ${reading.severity}, action needed: ${reading.actionNeeded ? "yes" : "no"}.` +
    (bill ? ` About ${bill.state} ${bill.bill_number}: ${gate?.ok ? "live" : gate?.reason}.` : "");

  const { data: tip, error } = await userClient
    .from("policy_alerts")
    .insert({
      kind: "intel_tip",
      severity: reading.severity,
      title,
      body: `${reading.summary}\n\nShared by a member with the iKratom link box.`.slice(0, 4000),
      locality: /^([A-Z]{2}|FED|ALL)$/.test(locality) ? locality : "ALL",
      source_url: ins.publisherUrl,
      bill_id: bill?.id ?? null,
      action_required: false,
      moderation_status: "pending",
      moderation_note: note.slice(0, 500),
      submitted_by_user_id: userId,
      is_anonymous: false,
      public_byline: null,
    })
    .select("id")
    .single();
  if (error || !tip) {
    console.error("[link-box] tip insert failed:", error?.message);
    return { ok: false, error: "We couldn't save that just now. Please try again in a minute." };
  }

  let draft = false;
  let draftReason: string | null = bill ? (gate?.ok ? null : gate?.reason ?? null) : null;
  if (bill && gate?.ok) {
    const r = await draftCampaign(bill, publicHandle(profile));
    draft = r.made;
    draftReason = r.reason;
    if (r.campaignId) {
      await createServiceRoleClient().from("policy_alerts").update({ campaign_id: r.campaignId }).eq("id", tip.id);
    }
  }
  return { ok: true, added: { tipId: tip.id as string, draft, draftReason } };
}

async function draftCampaign(bill: FullBill, handle: string): Promise<{ made: boolean; reason: string | null; campaignId: string | null }> {
  const sb = createServiceRoleClient();
  const { data: existing } = await sb.from("campaigns").select("id, review_state")
    .eq("bill_id", bill.id).not("review_state", "in", "(rejected,superseded)").limit(1);
  if (existing?.length) return { made: false, reason: "a campaign already exists", campaignId: null };

  const row = {
    ...buildCampaign(bill as unknown as Bill),
    active: false,
    review_state: "pending_review",
    auto_generated: false,
    hold_for_person: true,
    review_reason: `Shared through the link box by ${handle}. A person must approve this; the auto-approvers skip it.`,
  };
  let ins = await sb.from("campaigns").insert(row).select("id").single();
  if (ins.error?.code === "23505") {
    ins = await sb.from("campaigns").insert({ ...row, slug: `${row.slug}-${Date.now().toString(36)}`.slice(0, 80) }).select("id").single();
  }
  if (ins.error || !ins.data) {
    console.error("[link-box] draft insert failed:", ins.error?.message);
    return { made: false, reason: "could not save the draft", campaignId: null };
  }
  return { made: true, reason: null, campaignId: ins.data.id as string };
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "the web"; }
}
