/**
 * Who may change what in the forum. Pure, so the page can decide which buttons
 * to show and the server action can decide the same way when the button is
 * pressed. The server's answer is the one that counts.
 *
 *   Member         edits and deletes their own posts. Can't edit in a locked
 *                  thread, and can't touch what a moderator removed.
 *   Advocate       as a member, and hides other people's posts, locks and pins.
 *   Leader         Never rewrites someone else's words.
 *   Admin          as a leader, and may correct someone else's words, which
 *                  shows as "edited by a moderator". Also the bot's posts.
 *   Owner          everything.
 *
 * A moderator acts only on people they outrank, so a leader can't hide an
 * admin's post, and admins take a dispute with each other to the owner. Holding
 * `moderate_forum` is what makes someone a moderator: the owner can grant it to
 * a member or revoke it from a leader, and the rank follows that.
 */

export type ForumRole = "member" | "leader" | "admin" | "owner";

const RANK: Record<ForumRole, number> = { member: 0, leader: 1, admin: 2, owner: 3 };

/** What a thread's body becomes when its author deletes it after others replied. */
export const DELETED_THREAD_BODY = "[Deleted by the author]";

export function forumRoleOf(
  p?: { is_owner?: boolean | null; is_admin?: boolean | null; is_advocate_leader?: boolean | null } | null,
): ForumRole {
  if (p?.is_owner) return "owner";
  if (p?.is_admin) return "admin";
  if (p?.is_advocate_leader) return "leader";
  return "member";
}

export type ForumViewer = {
  id: string | null;
  role: ForumRole;
  /** Holds moderate_forum, by role or by the owner's grant. */
  canModerate: boolean;
};

export type ForumContent = {
  authorId: string | null;
  authorRole: ForumRole;
  /** Written by the bill bot rather than a person. */
  isBot: boolean;
  status?: string | null;
  threadLocked: boolean;
};

export type ForumRights = {
  /** Change the words. Someone else's words only for an admin or the owner. */
  edit: boolean;
  /** Delete your own. */
  delete: boolean;
  /** Hide someone else's, as a moderator. */
  remove: boolean;
};

export const NO_FORUM_RIGHTS: ForumRights = { edit: false, delete: false, remove: false };

export function forumRights(viewer: ForumViewer, content: ForumContent): ForumRights {
  if (!viewer.id) return NO_FORUM_RIGHTS;

  const own = viewer.id === content.authorId;
  const removed = content.status === "removed";
  const rank = Math.max(RANK[viewer.role], viewer.canModerate ? RANK.leader : RANK.member);
  // The bot ranks with leaders, so only an admin or the owner can act on it.
  const targetRank = content.isBot ? RANK.leader : RANK[content.authorRole];
  const moderates = viewer.canModerate && !own && rank > targetRank;

  return {
    edit: own
      ? !removed && (!content.threadLocked || viewer.canModerate)
      : moderates && rank >= RANK.admin,
    delete: own && !removed,
    remove: moderates && !removed,
  };
}

/** Admins, leaders and the owner skip the new-account review, as they do on a new post. */
export function isPrivilegedForumRole(viewer: ForumViewer): boolean {
  return viewer.canModerate || viewer.role !== "member";
}

// ── Spam limits ───────────────────────────────────────────────────────────────

const NEW_ACCOUNT_MS = 72 * 3600 * 1000;

/** Accounts under three days old get smaller posting limits. */
export function isNewForumAccount(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  return now - new Date(createdAt).getTime() < NEW_ACCOUNT_MS;
}

/** Whether two posts say the same thing, ignoring case and spacing. */
export function isSamePost(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return norm(a) === norm(b);
}
