"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Submit a user-contributed intel tip on a bill.
 *
 * Inserts into policy_alerts with kind='intel_tip' and
 * moderation_status='pending'. The existing intel-queue admin UI
 * (/admin/intel-queue) is where moderators review + approve.
 *
 * Anonymous submissions are allowed — both for users who are signed
 * in but want anonymity, and for unauthenticated visitors (we
 * accept null user_id with is_anonymous=true).
 *
 * Why we ride policy_alerts: it already has every field we need
 * (submitted_by_user_id, is_anonymous, moderation_status, locality,
 * bill_id, source_url). Doesn't need a new table. The existing
 * moderation flow already handles approval + downstream broadcasting.
 */
export type SubmitTipInput = {
  billId: string;
  billTitle: string;
  billState: string;
  billLocality: string | null;
  intel: string;
  sourceUrl?: string;
  contactBack?: boolean;
  isAnonymous?: boolean;
};

const MAX_INTEL = 4000;
const MIN_INTEL = 20;

export async function submitBillIntelTip(input: SubmitTipInput) {
  const intel = (input.intel ?? "").trim();
  if (intel.length < MIN_INTEL) return { error: `Intel must be at least ${MIN_INTEL} characters.` };
  if (intel.length > MAX_INTEL) return { error: `Intel too long (max ${MAX_INTEL} characters).` };
  if (!input.billId) return { error: "Missing bill reference." };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const isAnon = !!input.isAnonymous || !user;

  // Determine locality string: prefer the bill's locality (e.g.
  // "Suffolk County, NY"), fall back to the state code, fall back
  // to "ALL" — same convention as existing policy_alerts.
  const locality = input.billLocality || input.billState || "ALL";

  // Build the alert title — surfaces in /admin/intel-queue
  const title = `📝 User intel: ${input.billState} ${input.billTitle.slice(0, 80)}`;

  const row = {
    kind: "intel_tip",
    severity: "watch",
    title,
    body: intel,
    locality,
    bill_id: input.billId,
    source_url: input.sourceUrl?.trim() || null,
    submitted_by_user_id: !isAnon && user ? user.id : null,
    is_anonymous: isAnon,
    moderation_status: "pending",
    action_required: false,
  };

  const { error } = await supabase.from("policy_alerts").insert(row);
  if (error) return { error: error.message };

  revalidatePath(`/bills/${input.billId}`);
  return { ok: true };
}
