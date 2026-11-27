import type { SupabaseClient } from "@supabase/supabase-js";
import { drainBatch, type DrainBatchRow } from "./drain-batch";
import { acquireDrainLease } from "./drain-lease";

/**
 * Push ONE member's send queue forward for one slice. Shared by the campaign
 * page (continueMySend) and the app-shell driver (/api/campaigns/send-queue),
 * so a send keeps going on whatever page the member is on.
 *
 * One mailbox, one queue: the member's oldest unfinished batch goes first,
 * whichever page asked (Paul, 10-30: 120 NJ letters sat for 45 minutes behind
 * 138 ND ones while only the ND page was open). If the head makes no progress
 * the next one gets a turn, so a stall on one batch can't hold the others.
 *
 * Wrapped in the drain lease, so two tabs, a tab and the cron, or a laptop and
 * a phone never run two slices on one mailbox at once. A caller that finds the
 * lease taken gets `busy` and sends nothing.
 */

export const ACTIVE_BATCH_STATUSES = ["queued", "sending", "paused"];

export const DRAIN_BATCH_COLUMNS =
  "id, user_id, campaign_id, subject_template, body_template, status, total_count, sent_count, failed_count, pause_reason";

export type DriveResult = { busy: boolean; sent: number; failed: number };

export async function driveMemberQueue(
  admin: SupabaseClient,
  userId: string,
  opts: { deadline: number; prefer?: DrainBatchRow | null },
): Promise<DriveResult> {
  const lease = await acquireDrainLease(userId);
  if (!lease) return { busy: true, sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  try {
    const { data } = await admin
      .from("campaign_send_batches")
      .select(DRAIN_BATCH_COLUMNS)
      .eq("user_id", userId)
      .in("status", ACTIVE_BATCH_STATUSES)
      .order("created_at", { ascending: true })
      .limit(2);
    // Belt and braces: the filter above is the ownership check, so re-assert it.
    const order: DrainBatchRow[] = ((data ?? []) as DrainBatchRow[]).filter((b) => b.user_id === userId);
    const prefer = opts.prefer;
    if (prefer && prefer.user_id === userId && !order.some((b) => b.id === prefer.id)) order.push(prefer);

    for (const [i, batch] of order.entries()) {
      if (i > 0 && Date.now() >= opts.deadline - 2_000) break;
      const r = await drainBatch(admin, batch, opts.deadline);
      sent += r.sent;
      failed += r.failed;
      if (r.sent + r.failed > 0) break;
    }
  } finally {
    await lease.release();
  }
  return { busy: false, sent, failed };
}

export type QueueStatus = "idle" | "sending" | "paused";
export type QueueState = { status: QueueStatus; remaining: number };

type BatchCounts = { status: string; total_count: number | null; sent_count: number | null; failed_count: number | null };

/** "sending" while any batch can move now, "paused" when all that's left is waiting, else "idle". */
export function summarizeQueue(rows: BatchCounts[]): QueueState {
  let remaining = 0;
  let live = false;
  let paused = false;
  for (const b of rows) {
    if (!ACTIVE_BATCH_STATUSES.includes(b.status)) continue;
    remaining += Math.max(0, (b.total_count ?? 0) - (b.sent_count ?? 0) - (b.failed_count ?? 0));
    if (b.status === "paused") paused = true;
    else live = true;
  }
  return { status: live ? "sending" : paused ? "paused" : "idle", remaining };
}

export async function readQueueState(supabase: SupabaseClient, userId: string): Promise<QueueState> {
  const { data } = await supabase
    .from("campaign_send_batches")
    .select("status, total_count, sent_count, failed_count")
    .eq("user_id", userId)
    .in("status", ACTIVE_BATCH_STATUSES);
  return summarizeQueue((data ?? []) as BatchCounts[]);
}
