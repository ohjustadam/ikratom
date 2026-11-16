import { checkRateLimit } from "@/lib/rate-limit";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * One drain slice per member at a time, whoever asks.
 *
 * Three things can push a member's send queue forward: the campaign page
 * (continueMySend), the app-shell driver on any other page
 * (/api/campaigns/send-queue), and the cron worker. Before 2026-11-11 the only
 * guard was a 1-per-4-seconds rate limit, and a slice runs for 15 seconds, so a
 * second tab could start a second slice on the same mailbox while the first was
 * still sending. Three things went wrong then:
 *   - The letter in flight could go out twice. drainBatch's compare-and-swap
 *     stops two slices that read a recipient at the same moment, but a slice
 *     that starts while another is mid-send reads that recipient as still
 *     "pending" with the attempt already counted, so its own swap succeeds
 *     (tests/send-queue-off-page.test.ts, "starts mid-slice").
 *   - Each slice read "sent today" once at its start, so two at once could
 *     pass the daily cap.
 *   - Each paced itself alone: twice the provider's per-minute pace.
 *

 * This is a lease: taken before a slice and released when it ends. It reuses
 * the atomic check_rate_limit row (`select … for update`): with max 1, a second
 * caller inside the window is refused. Releasing pushes the row's window back
 * to the epoch, so the next caller starts a fresh window at once instead of
 * waiting out the rest of this one. The release only applies to the window it
 * took, so a holder that ran past the window can never free someone else's
 * lease.
 *
 * DRAIN_LEASE_SECONDS is well past the longest slice (15-20 s, and the host
 * kills a function at ~30 s), so a slice that dies without releasing blocks
 * its member for under a minute, never longer.
 *
 * checkRateLimit fails open when the database is unreachable, but then the
 * drain's own reads and writes fail too, so nothing goes out to double up.
 */
export const DRAIN_LEASE_SECONDS = 45;

const EPOCH = "1970-01-01T00:00:00.000Z";

/** The same key the old 1-per-4s throttle used, so every past sender already has its row. */
export const drainLeaseKey = (userId: string) => `campaign:drain:${userId}`;

/**
 * Make sure the member's lease row exists before their first drain. With no
 * row, check_rate_limit's first-call path inserts with `on conflict do
 * nothing` and returns true to every caller in the race, so two tabs on a
 * member's very first send could both hold the lease. Called when a send is
 * queued; a no-op for anyone who already has the row.
 */
export async function ensureDrainLeaseRow(userId: string): Promise<void> {
  try {
    await createServiceRoleClient()
      .from("rate_limits")
      .upsert({ key: drainLeaseKey(userId), window_start: EPOCH, count: 0 }, { onConflict: "key", ignoreDuplicates: true });
  } catch {
    /* best effort: the lease still works, minus this one first-call race */
  }
}

export type DrainLease = { release: () => Promise<void> };

export async function acquireDrainLease(userId: string): Promise<DrainLease | null> {
  const key = drainLeaseKey(userId);
  if (!(await checkRateLimit(key, 1, DRAIN_LEASE_SECONDS))) return null;

  // Which window did we take? Nobody else can move it while we hold it (they
  // are refused, which writes nothing), so reading it now is safe.
  let windowStart: string | null = null;
  try {
    const { data } = await createServiceRoleClient()
      .from("rate_limits")
      .select("window_start")
      .eq("key", key)
      .maybeSingle();
    windowStart = (data?.window_start as string | undefined) ?? null;
  } catch {
    /* no release then; the lease simply expires */
  }

  return {
    async release() {
      if (!windowStart) return;
      try {
        await createServiceRoleClient()
          .from("rate_limits")
          .update({ window_start: EPOCH, count: 0 })
          .eq("key", key)
          .eq("window_start", windowStart);
      } catch {
        /* best effort: an unreleased lease expires after DRAIN_LEASE_SECONDS */
      }
    },
  };
}
