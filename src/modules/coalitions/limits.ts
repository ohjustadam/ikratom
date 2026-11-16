/**
 * Length limits for group discussion posts, shared by the forms, the server
 * actions and (by hand) the database checks in migration 0321.
 *
 * The body limit was 5,000 until 2026-11-11, when PJ's letter to an editor
 * (rebutting a news article) was cut off mid-paste. 10,000 holds a long letter
 * with room to spare; the state forums allow 20,000.
 */
export const GROUP_TITLE_MAX = 140;
export const GROUP_POST_MAX = 10_000;

/** The counter shows from this share of the limit, so short posts stay uncluttered. */
const SHOW_FROM = 0.8;

/**
 * What the counter under a group post box says, or null while there's plenty
 * of room. The boxes have no hard `maxLength`, because the browser would cut a
 * long paste without a word, which is what lost PJ's letter. The member sees
 * the count instead, and the Post button waits until the text fits.
 */
export function groupPostLengthNote(
  length: number,
  max: number = GROUP_POST_MAX,
): { text: string; over: boolean } | null {
  if (length < max * SHOW_FROM) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (length > max) {
    return { text: `${fmt(length)} / ${fmt(max)} characters. Cut ${fmt(length - max)} to post.`, over: true };
  }
  return { text: `${fmt(length)} / ${fmt(max)} characters`, over: false };
}
