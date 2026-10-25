"use server";

import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { NOTE_MAX, isReportReason, isReportTarget, isTargetId } from "./types";

/**
 * Report something a member posted (migration 0288). The ONLY entry point:
 * every ReportButton calls this. report_content refuses anything the reporter
 * cannot see and anything they own, so a forged call can't probe for content.
 * 20 reports a day per member.
 */
export async function reportContent(input: {
  targetType: string;
  targetId: string;
  reason: string;
  note?: string;
}): Promise<{ ok: true } | { error: string }> {
  if (!isReportTarget(input.targetType) || !isTargetId(input.targetId)) return { error: "That can't be reported." };
  if (!isReportReason(input.reason)) return { error: "Pick a reason." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to report." };
  if (!(await checkRateLimit(`content-report:${user.id}`, 20, 86_400))) {
    return { error: "You've sent a lot of reports today. Thank you; our moderators are on it." };
  }
  const { data, error } = await supabase.rpc("report_content", {
    p_type: input.targetType,
    p_id: input.targetId,
    p_reason: input.reason,
    p_note: (input.note ?? "").trim().slice(0, NOTE_MAX) || null,
  });
  if (error || data !== true) return { error: "Could not send that report." };
  return { ok: true };
}
