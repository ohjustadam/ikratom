"use server";

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";

/**
 * Server-only audit log helper. Records sensitive admin actions for
 * accountability. Uses service-role client so the row writes regardless of
 * user-side RLS — but we always capture the actor_id from the auth session.
 *
 * Actions to log:
 *   - role_change (admin promotes/demotes user)
 *   - campaign_created / campaign_archived
 *   - thread_locked / thread_pinned / post_deleted
 *   - user_blocked / user_warned (admin actions, not user-side blocks)
 *   - sync_triggered (legislator/congress/capitals)
 */
export async function recordAdminAction(input: {
  action: string;
  targetType?: "user" | "campaign" | "thread" | "post" | "legislator" | "forum_community";
  targetId?: string;
  details?: Record<string, unknown>;
}) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? null,
      action: input.action.slice(0, 80),
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      details: input.details ?? null,
    });
  } catch (e) {
    // Audit log failures should never block real actions
    console.error("[audit]", e);
  }
}
