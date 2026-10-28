import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { checkRateLimit } from "@/lib/rate-limit";
import { extractMentions } from "@/lib/mentions";
import { fanoutPushNotifications } from "@/modules/notifications/push-fanout";

/**
 * Notify the members a Lounge message @mentions (owner ask 2026-10-28).
 *
 * Each mentioned member gets an ordinary `notifications` row (kind 'mention'):
 * it shows in their inbox and bell count at once, it rides the daily email
 * digest, and it is pushed to their phone immediately through the shared
 * fan-out (opt-outs, quiet hours and digest-cadence users are still honoured;
 * only the 2-hour batching interval is skipped, because a mention is one
 * person talking to another).
 *
 * Abuse limits, all server-side:
 *   - at most 3 people per message (extractMentions);
 *   - a sender's mentions notify at most 20 people an hour;
 *   - the same sender can notify the same person at most once per 10 minutes;
 *   - never yourself, and never across a block in either direction.
 * Identity stays public-safe: the notification names the sender by @username
 * only, and resolution is exact-match (no username search is exposed).
 */
export async function notifyLoungeMentions(input: {
  senderId: string;
  senderUsername: string | null;
  messageId: string;
  body: string;
}): Promise<number> {
  const handles = extractMentions(input.body);
  if (handles.length === 0 || !input.senderUsername) return 0;
  const admin = createServiceRoleClient();

  const { data: targets } = await admin
    .from("profiles")
    .select("id, username")
    .in("username", handles)
    .neq("id", input.senderId);
  let ids = (targets ?? []).map((t) => t.id as string);
  if (ids.length === 0) return 0;

  const { data: blocks } = await admin
    .from("user_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `and(blocker_id.eq.${input.senderId},blocked_id.in.(${ids.join(",")})),` +
        `and(blocked_id.eq.${input.senderId},blocker_id.in.(${ids.join(",")}))`,
    );
  const blocked = new Set((blocks ?? []).flatMap((b) => [b.blocker_id as string, b.blocked_id as string]));
  ids = ids.filter((id) => !blocked.has(id));

  const allowed: string[] = [];
  for (const id of ids) {
    if (!(await checkRateLimit(`mention:sender:${input.senderId}`, 20, 3600))) break;
    if (await checkRateLimit(`mention:pair:${input.senderId}:${id}`, 1, 600)) allowed.push(id);
  }
  if (allowed.length === 0) return 0;

  const snippet = input.body.length > 140 ? `${input.body.slice(0, 139)}…` : input.body;
  const { error } = await admin.from("notifications").insert(
    allowed.map((user_id) => ({
      user_id,
      kind: "mention",
      title: `@${input.senderUsername} mentioned you in the Lounge`,
      body: snippet,
      link: `/?lounge=${input.messageId}`,
    })),
  );
  if (error) {
    console.error("mention notify insert failed:", error.message);
    return 0;
  }

  try {
    await fanoutPushNotifications(admin, { userIds: allowed, kinds: ["mention"], instant: true });
  } catch (e) {
    // The inbox row is in; the regular sweep pushes it if this instant try fails.
    console.error("mention instant push failed:", e instanceof Error ? e.message : e);
  }
  return allowed.length;
}
