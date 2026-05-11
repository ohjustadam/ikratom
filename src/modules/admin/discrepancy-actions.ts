"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

/**
 * Admin actions for /admin/sync-discrepancies.
 *
 * - resolveDiscrepancy — marks the kind='scraper_stale' policy_alert
 *   as rejected so it moves to the "resolved" section. Audit-logged.
 * - forceResyncBill — sets the bill's last_synced_at to epoch 0,
 *   pushing it to the front of the next LegiScan priority cron tick.
 *   Same mechanism as the news-triggered hot-resync.
 */

export async function resolveDiscrepancy(input: { alertId: string; note: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.alertId) return { error: "Missing alert id." };

  const note = input.note.slice(0, 500).trim();
  if (!note) return { error: "Note required." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("policy_alerts")
    .update({
      moderation_status: "rejected",
      moderation_note: `Resolved by admin: ${note}`,
      moderated_by: ctx.userId,
      moderated_at: new Date().toISOString(),
    })
    .eq("id", input.alertId)
    .eq("kind", "scraper_stale");
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "sync_discrepancy_resolved",
    targetType: "policy_alert",
    targetId: input.alertId,
    details: { note },
  });
  revalidatePath("/admin/sync-discrepancies");
  return { ok: true };
}

export async function forceResyncBill(input: { billId: string }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admin only." };
  if (!input.billId) return { error: "Missing bill id." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bills")
    .update({ last_synced_at: new Date(0).toISOString() })
    .eq("id", input.billId);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "bill_force_resync",
    targetType: "bill",
    targetId: input.billId,
  });
  revalidatePath("/admin/sync-discrepancies");
  return { ok: true };
}
