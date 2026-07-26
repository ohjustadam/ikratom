"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Admin moderation for the calls→intel pipeline. A user who finishes a tracked
 * call can opt to "submit for review" (moderation_status='pending_review'); an
 * admin approves it here, which is the ONLY path that publishes it to the public
 * /calls/board intel surface (via the public_call_intel view, migration 0184).
 *
 * Calls are HUMAN-moderated, never auto-approved: a transcript can name + quote
 * an official, so a person must sign off before anything goes public. The public
 * surface shows only the quote-free public_summary_md + position (the verbatim
 * ai_summary_md stays private).
 */

export type PendingCall = {
  id: string;
  recipient_name: string | null;
  recipient_role: string | null;
  recipient_office: string | null;
  state: string | null;
  started_at: string;
  duration_seconds: number | null;
  outcome: string | null;
  legislator_position: string | null;
  ai_summary_md: string | null;      // full (with quotes) — admin review only
  public_summary_md: string | null;  // quote-free — what would publish
  transcript_md: string | null;      // raw — admin review only
  user_notes_md: string | null;
};

export async function listPendingCalls(): Promise<PendingCall[]> {
  const ctx = await getAdminContext({ require: "moderate_calls" });
  if (!ctx.ok) return [];
  const sb = await createClient();
  const { data } = await sb
    .from("call_sessions")
    .select(
      "id, recipient_name, recipient_role, recipient_office, state, started_at, duration_seconds, " +
      "outcome, legislator_position, ai_summary_md, public_summary_md, transcript_md, user_notes_md",
    )
    .eq("moderation_status", "pending_review")
    .order("started_at", { ascending: true })
    .limit(200);
  return (data ?? []) as unknown as PendingCall[];
}

export async function pendingCallCount(): Promise<number> {
  const ctx = await getAdminContext({ require: "moderate_calls" });
  if (!ctx.ok) return 0;
  const sb = await createClient();
  const { count } = await sb
    .from("call_sessions")
    .select("id", { count: "exact", head: true })
    .eq("moderation_status", "pending_review");
  return count ?? 0;
}

export async function setCallModeration(input: {
  id: string;
  action: "approve" | "reject";
  note?: string;
}) {
  const ctx = await getAdminContext({ require: "moderate_calls" });
  if (!ctx.ok) return { error: "Admin only." };
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid id." };
  if (input.action !== "approve" && input.action !== "reject") return { error: "Unknown action." };

  const sb = await createClient();
  const { error } = await sb
    .from("call_sessions")
    .update({
      moderation_status: input.action === "approve" ? "approved" : "rejected",
      moderation_reviewed_by: ctx.userId,
      moderation_reviewed_at: new Date().toISOString(),
      moderation_note: (input.note ?? "").slice(0, 500) || null,
    })
    .eq("id", input.id)
    .eq("moderation_status", "pending_review"); // race guard: only act on still-pending rows
  if (error) return { error: error.message };

  await recordAdminAction({
    action: `call_${input.action}d`,
    targetType: "policy_alert", // nearest allowed target_type for a call record
    targetId: input.id,
    details: { note: input.note ?? null },
  });
  revalidatePath("/admin/calls");
  revalidatePath("/calls/board");
  return { ok: true };
}
