/**
 * @mentions — one shared parser for every surface that lets members tag each
 * other (the Lounge today; forum and group posts can reuse it unchanged).
 *
 * A mention is `@` + a username, at the start of the text or after a space or
 * punctuation (so emails like a@b.com never match). Usernames are matched
 * case-insensitively and returned lowercased, de-duplicated, in order.
 */

export const MAX_MENTIONS_PER_MESSAGE = 3;

const MENTION_RE = /(^|[^\w@.])@([a-z0-9_]{2,30})(?![\w])/gi;

export function extractMentions(text: string, max = MAX_MENTIONS_PER_MESSAGE): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(MENTION_RE)) {
    const handle = m[2].toLowerCase();
    if (!out.includes(handle)) out.push(handle);
    if (out.length >= max) break;
  }
  return out;
}

export type MentionPart = { text: string; mention?: string };

/** Split text into plain runs and @mention runs, for highlighting in the UI. */
export function splitMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const m of (text ?? "").matchAll(MENTION_RE)) {
    const at = (m.index ?? 0) + m[1].length;
    if (at > last) parts.push({ text: text.slice(last, at) });
    parts.push({ text: `@${m[2]}`, mention: m[2].toLowerCase() });
    last = at + 1 + m[2].length;
  }
  if (last < (text ?? "").length) parts.push({ text: text.slice(last) });
  return parts;
}

/**
 * The @word being typed at the caret, for autocomplete. Returns the partial
 * handle (without @) and where it starts, or null when the caret isn't in one.
 */
export function mentionAtCaret(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[\s(])@([a-z0-9_]{0,30})$/i);
  if (!m) return null;
  return { query: m[2].toLowerCase(), start: caret - m[2].length - 1 };
}

/** Replace the @partial at `start` with the full handle plus a trailing space. */
export function completeMention(text: string, start: number, caret: number, handle: string): string {
  return `${text.slice(0, start)}@${handle} ${text.slice(caret).replace(/^\s+/, "")}`;
}
