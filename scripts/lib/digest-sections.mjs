/**
 * Notification kinds that belong in a member's email digest, by section.
 * Anything not listed (admin queues, security notices, internal tooling) never
 * emails. Read by scripts/send-email-notifications.mjs. tests/group-notifications
 * scans the code for every group kind so a new one can't silently skip email.
 */

/**
 * THE SWITCH for group notices in the email digest. OFF until the 12-05
 * production build ships the "Your groups" setting (trunk, 2026-11-18: we
 * don't email members something they can't switch off on its own). The trunk
 * flips this to true in the same merge window as that build. Nothing else
 * needs to change.
 */
export const GROUPS_IN_DIGEST = false;

/** Groups the member joined (2026-11-17). The inbox row is already gated by notify_groups (0327). */
export const GROUP_SECTION = {
  title: "Your groups",
  kinds: ["coalition_discussion", "coalition_event", "coalition_action", "coalition_join_request"],
  // Every group notice shares a title shape ("New reply in X"), so headline
  // matching would fold different threads into one line. Dedupe by link.
  dedupe: "link",
};

export const SECTIONS = [
  { title: "Mentioned you", kinds: ["mention"] },
  // The team answered their feedback (/admin/feedback reply, 2026-11-10).
  { title: "Replies to your feedback", kinds: ["feedback_reply"] },
  { title: "Action needed", kinds: ["policy_alert", "new_campaign", "voting_reminder"] },
  ...(GROUPS_IN_DIGEST ? [GROUP_SECTION] : []),
  { title: "Your state", kinds: ["state_news"] },
  { title: "Around the country", kinds: ["national_news"] },
  { title: "From iKratom", kinds: ["briefing", "whats_new", "reps_added"] },
];

export const DIGEST_KINDS = SECTIONS.flatMap((s) => s.kinds);

/** One line per link (newest first in, first kept): ten replies in one thread read once. */
export function dedupeByLink(items) {
  const seen = new Set();
  return items.filter((n) => {
    const k = n.link || `${n.title}\n${n.body ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
