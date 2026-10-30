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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAdminAction(input: {
  action: string;
  targetType?: "user" | "campaign" | "thread" | "post" | "legislator" | "forum_community" | "external_community" | "policy_alert" | "bill" | "state";
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

    // target_id is a uuid column. A state code or slug there failed the
    // insert, and the error was never read, so those actions went unlogged
    // (every state_status.confirm until 2026-10-29). Non-uuid ids now ride
    // in details.target.
    const id = input.targetId ?? null;
    const uuid = id !== null && UUID_RE.test(id);
    const { error } = await admin.from("admin_audit_log").insert({
      actor_id: user.id,
      actor_email: user.email ?? null,
      action: input.action.slice(0, 80),
      target_type: input.targetType ?? null,
      target_id: uuid ? id : null,
      details: id && !uuid ? { ...(input.details ?? {}), target: id } : input.details ?? null,
    });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (e) {
    // Audit log failures should never block real actions
    console.error("[audit]", e);
  }
}
