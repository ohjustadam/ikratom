/**
 * Group home (migration 0284): the pure halves of the wins feed and the
 * welcome checklist, so the page renders them and the tests pin them.
 */

export type WinsRow = {
  letters_7d: number;
  letters_total: number;
  officials_7d: number;
  members_acted_7d: number;
  members_total: number;
  new_members_7d: number;
  events_7d: number;
  events_upcoming: number;
  posts_7d: number;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The non-zero wins, as short sentences. Counts only, never a name. */
export function winLines(w: WinsRow): { icon: string; text: string }[] {
  const lines: { icon: string; text: string }[] = [];
  if (w.letters_7d > 0) lines.push({ icon: "✉️", text: `${plural(w.letters_7d, "letter")} sent this week` });
  if (w.officials_7d > 0) lines.push({ icon: "🏛", text: `${plural(w.officials_7d, "official")} heard from the group` });
  if (w.members_acted_7d > 0) lines.push({ icon: "⚡", text: `${plural(w.members_acted_7d, "member")} took action` });
  if (w.new_members_7d > 0) lines.push({ icon: "👋", text: `${plural(w.new_members_7d, "new member")} joined` });
  if (w.events_7d > 0) lines.push({ icon: "📅", text: `${plural(w.events_7d, "event")} held` });
  if (w.posts_7d > 0) lines.push({ icon: "💬", text: `${plural(w.posts_7d, "new post")} on the board` });
  return lines;
}

export type ChecklistStep = { key: string; label: string; done: boolean; href: string; cta: string };

/** A new member's first four steps: join → introduce yourself → take the group action → invite one person. */
export function memberChecklist(s: {
  slug: string;
  introduced: boolean;
  acted: boolean;
  shared: boolean;
  pinnedThreadId: string | null;
  actionHref: string;
}): ChecklistStep[] {
  return [
    { key: "join", label: "Join the group", done: true, href: `/coalitions/${s.slug}`, cta: "" },
    {
      key: "intro", label: "Introduce yourself on the board", done: s.introduced,
      href: s.pinnedThreadId ? `/coalitions/${s.slug}/t/${s.pinnedThreadId}#reply` : `/coalitions/${s.slug}?intro=1#discussion`,
      cta: "Say hi",
    },
    { key: "act", label: "Take the group action", done: s.acted, href: s.actionHref, cta: "Act now" },
    { key: "invite", label: "Invite one person", done: s.shared, href: `/coalitions/${s.slug}#invite`, cta: "Share link" },
  ];
}

/** The organizer's version: what makes a group worth joining. */
export function organizerChecklist(s: {
  slug: string;
  shared: boolean;
  hasPinned: boolean;
  hasAction: boolean;
  hasEvent: boolean;
}): ChecklistStep[] {
  return [
    { key: "invite", label: "Share your group link", done: s.shared, href: `/coalitions/${s.slug}#invite`, cta: "Share link" },
    { key: "welcome", label: "Pin a welcome post", done: s.hasPinned, href: `/coalitions/${s.slug}?welcome=1#discussion`, cta: "Write it" },
    { key: "act", label: "Pick this week's group action", done: s.hasAction, href: `/coalitions/${s.slug}#group-action`, cta: "Pick one" },
    { key: "event", label: "Plan your first event", done: s.hasEvent, href: `/coalitions/${s.slug}?plan=1#events`, cta: "Plan it" },
  ];
}

/**
 * The group badge (B4 g): a tier earned by the letters the group has sent
 * since it began (coalition_wins().letters_total). A collective count only.
 */
export const GROUP_BADGES = [
  { min: 10, icon: "🌱", name: "Seedling" },
  { min: 50, icon: "🍃", name: "Leaf" },
  { min: 250, icon: "🌿", name: "Grove" },
  { min: 1000, icon: "🌳", name: "Forest" },
] as const;

export type GroupBadge = { icon: string; name: string; next: { name: string; at: number } | null };

/** The badge for this many letters (null below the first tier), and the next one to aim for. */
export function groupBadge(letters: number): GroupBadge | null {
  const n = Math.max(0, Math.floor(letters || 0));
  const i = GROUP_BADGES.findLastIndex((b) => n >= b.min);
  const nextTier = GROUP_BADGES[i + 1];
  const next = nextTier ? { name: nextTier.name, at: nextTier.min } : null;
  return i < 0 ? null : { icon: GROUP_BADGES[i].icon, name: GROUP_BADGES[i].name, next };
}
