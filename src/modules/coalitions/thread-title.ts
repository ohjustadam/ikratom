import { GROUP_TITLE_MAX } from "./limits";

/** Longest title made from a post's first line; a typed title may use the full limit. */
export const AUTO_TITLE_MAX = 80;

/**
 * A group discussion's title. The title box is optional (2026-11-17, fewer
 * clicks to post): a member can just write, and the post's first line becomes
 * the title on the board. Pure, so the form's hint and the server agree.
 * Returns null when there is nothing to make a title from.
 */
export function threadTitle(typed: string, body: string, hasPhoto: boolean): string | null {
  const t = (typed ?? "").replace(/\s+/g, " ").trim();
  if (t.length >= 3) return t.slice(0, GROUP_TITLE_MAX);

  const first = ((body ?? "").split(/\r?\n/).find((l) => l.trim()) ?? "").replace(/\s+/g, " ").trim();
  if (first.length >= 3) {
    if (first.length <= AUTO_TITLE_MAX) return first;
    const cut = first.slice(0, AUTO_TITLE_MAX - 1);
    const space = cut.lastIndexOf(" ");
    return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return hasPhoto ? "📷 A photo for the group" : null;
}
