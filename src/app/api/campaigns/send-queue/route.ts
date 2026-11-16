import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { driveMemberQueue, readQueueState, type QueueState } from "@/modules/campaigns/drive-queue";

/**
 * /api/campaigns/send-queue — keeps a member's one-click send going on any page.
 *
 * WHY (PJ, 2026-11-11): "Sending · 15 of 110", then PJ left the campaign page to
 * write a group post and the send stopped until they came back minutes later.
 * Only the campaign page drove the queue; the cron safety net runs ~22 times a
 * day. SendQueueDriver (in the app shell) now calls this on whatever page the
 * member is on, one ~15 s slice at a time, while their browser holds a send.
 *
 * WHY A ROUTE, NOT A SERVER ACTION: Next runs server actions one at a time per
 * tab. A 15 s drain held as a server action would make the member's forum post,
 * reaction or DM (all server actions) wait behind it, and a navigation that
 * pre-empts a pending action leaves its promise unresolved, which would freeze
 * the driver. A plain fetch is outside that queue.
 *
 * WHAT IT CAN DO: only push the caller's OWN queued batches, which they
 * authorised when they pressed Send. It picks no recipients and writes no
 * letter. Every safety rule lives in drainBatch, unchanged: the daily cap, the
 * per-minute pace, the per-recipient compare-and-swap. The drain lease keeps
 * it to one slice per mailbox across tabs, the campaign page and the cron.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Same slice as the campaign page's continueMySend, under the host's ~30 s budget. */
const SLICE_MS = 15_000;

export type SendQueueResponse = QueueState & { busy: boolean };

const json = (body: SendQueueResponse, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // A custom header can't be set by a cross-site form, and a cross-origin
  // fetch carrying one needs a preflight this route never answers.
  if (request.headers.get("x-ikratom-send-queue") !== "1") {
    return json({ status: "idle", remaining: 0, busy: false }, 400);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ status: "idle", remaining: 0, busy: false }, 401);

  // Nothing queued: one read through the member's own client (RLS) and done.
  const before = await readQueueState(supabase, user.id);
  if (before.status === "idle") return json({ ...before, busy: false });

  const r = await driveMemberQueue(createServiceRoleClient(), user.id, { deadline: Date.now() + SLICE_MS });
  const after = await readQueueState(supabase, user.id);
  return json({ ...after, busy: r.busy });
}
