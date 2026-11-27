/**
 * Tell a member, once, that their connected email stopped working and their
 * letters are waiting.
 *
 * Found 2026-11-25: the member who sends most letters lost their Gmail link on
 * 11-14. drainBatch paused their batch with "Reconnect in /account", but that
 * text lived only on the batch row, so nothing reached them and their sending
 * stopped for 11 days. Now a pause for a dropped link sends one in-app notice
 * (kind "campaign_send_batch", which the opt-out gate always delivers) and one
 * platform email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The two pause reasons drainBatch writes when the member's mail link is gone. */
export const LINK_PAUSE_REASONS = {
  disconnected: "Email account disconnected. Reconnect in /account to resume.",
  revoked: "Your email connection was revoked. Reconnect in /account and this batch resumes where it stopped.",
} as const;

const LINK_REASONS: readonly string[] = Object.values(LINK_PAUSE_REASONS);

/**
 * True when pausing this batch for a dropped link is news to the member.
 * The drain re-reads paused batches every run, so a batch already paused for
 * a dropped link must not notify again.
 */
export function linkDropNoticeDue(batch: { status: string; pause_reason?: string | null }): boolean {
  return !(batch.status === "paused" && LINK_REASONS.includes(batch.pause_reason ?? ""));
}

function noticeText(waiting: number) {
  const letters = `${waiting} letter${waiting === 1 ? "" : "s"}`;
  return {
    title: "Your email link dropped",
    body:
      `Your connected email account stopped working, so ${letters} you queued ${waiting === 1 ? "is" : "are"} waiting. ` +
      "Reconnect it in your account and they go out where they stopped.",
  };
}

/** Best effort: a failed notice never stops or fails the send. */
export async function noticeMailLinkDropped(
  supabase: SupabaseClient,
  userId: string,
  waiting: number,
): Promise<void> {
  const { title, body } = noticeText(Math.max(0, waiting));
  const appUrl = process.env.APP_URL ?? "https://www.ikratom.org";

  await supabase
    .from("notifications")
    .insert({ user_id: userId, kind: "campaign_send_batch", title, body, link: "/account" })
    .then(() => {}, () => {});

  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const to = data?.user?.email;
    if (!to) return;
    const { sendTransactionalEmail, brandedHtml } = await import("@/lib/email/transactional");
    await sendTransactionalEmail({
      to,
      subject: title,
      text: `${body}\n\n${appUrl}/account`,
      html: brandedHtml({ headline: title, body: `<p>${body}</p>`, ctaLabel: "Reconnect my email", ctaHref: `${appUrl}/account` }),
      tag: "mail_link_dropped",
    });
  } catch (e) {
    console.error("[noticeMailLinkDropped] email failed:", e);
  }
}
