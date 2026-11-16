import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * A signed-in member's own feedback and the team's replies, for /feedback.
 * Server-only (not a server action). Reads with the service role AFTER the
 * session check, filtered to this member's rows, and selects only the text
 * and dates: never who on the team wrote a reply.
 */
export type MyFeedback = {
  id: string;
  message: string;
  status: string;
  created_at: string;
  replies: { body: string; created_at: string }[];
};

export async function listMyFeedback(): Promise<
  { ok: true; rows: MyFeedback[] } | { error: "signed_out" | string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "signed_out" };

  const sr = createServiceRoleClient();
  const { data: reports, error } = await sr
    .from("feedback_reports")
    .select("id,message,status,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { error: error.message };
  const list = (reports ?? []) as Omit<MyFeedback, "replies">[];
  if (list.length === 0) return { ok: true, rows: [] };

  const { data: replies } = await sr
    .from("feedback_replies")
    .select("report_id,body,created_at")
    .in("report_id", list.map((r) => r.id))
    .neq("status", "pending")
    .order("created_at", { ascending: true });
  const byReport = new Map<string, MyFeedback["replies"]>();
  for (const r of (replies ?? []) as { report_id: string; body: string; created_at: string }[]) {
    if (!byReport.has(r.report_id)) byReport.set(r.report_id, []);
    byReport.get(r.report_id)!.push({ body: r.body, created_at: r.created_at });
  }
  return { ok: true, rows: list.map((r) => ({ ...r, replies: byReport.get(r.id) ?? [] })) };
}
