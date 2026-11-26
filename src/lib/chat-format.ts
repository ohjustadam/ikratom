/**
 * Lounge message formatting: **bold** and *italic* (or _italic_), parsed into
 * plain segments that the UI renders as React elements. Nothing here ever
 * becomes HTML, so a message can't inject markup (owner ask 2026-11-25, B8).
 *
 * Markers only count when they hug text: "5 * 3 * 2" and snake_case_words stay
 * as typed, and an @mention like @_cool_ is never eaten by the italic rule.
 */

export type ChatSegment = { text: string; bold: boolean; italic: boolean };

const BOTH = /(?<!\*)\*\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*\*(?!\*)/;
const BOLD = /(?<!\*)\*\*(?=[^\s*])([^\n]*?[^\s*])\*\*(?!\*)/;
const ITALIC_STAR = /(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/;
const ITALIC_UNDER = /(?<![\w@_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\w_])/;
const MAX_DEPTH = 3;
type Kind = "bold" | "italic" | "both";

function earliest(text: string, bold: boolean, italic: boolean) {
  let best: { index: number; length: number; inner: string; kind: Kind } | null = null;
  const tries: [RegExp, Kind][] = [];
  if (!bold && !italic) tries.push([BOTH, "both"]);
  if (!bold) tries.push([BOLD, "bold"]);
  if (!italic) tries.push([ITALIC_STAR, "italic"], [ITALIC_UNDER, "italic"]);
  for (const [re, kind] of tries) {
    const m = re.exec(text);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, length: m[0].length, inner: m[1], kind };
    }
  }
  return best;
}

function walk(text: string, bold: boolean, italic: boolean, depth: number, out: ChatSegment[]) {
  let rest = text;
  while (rest.length > 0) {
    const hit = depth < MAX_DEPTH ? earliest(rest, bold, italic) : null;
    if (!hit) { push(out, { text: rest, bold, italic }); return; }
    if (hit.index > 0) push(out, { text: rest.slice(0, hit.index), bold, italic });
    walk(hit.inner, bold || hit.kind !== "italic", italic || hit.kind !== "bold", depth + 1, out);
    rest = rest.slice(hit.index + hit.length);
  }
}

function push(out: ChatSegment[], seg: ChatSegment) {
  const last = out[out.length - 1];
  if (last && last.bold === seg.bold && last.italic === seg.italic) last.text += seg.text;
  else out.push({ ...seg });
}

export function parseChatFormat(body: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  walk(body ?? "", false, false, 0, out);
  return out;
}

/** The message as plain words, for push notifications and previews. */
export function stripChatFormat(body: string): string {
  return parseChatFormat(body).map((s) => s.text).join("");
}

/**
 * The toolbar's B and I buttons: wrap the selection in a marker, or take the
 * marker off again when the selection is already wrapped. With nothing
 * selected it inserts an empty pair and puts the caret between them. Works by
 * counting the stars hugging the selection: 1 = italic, 2 = bold, 3 = both.
 */
export function toggleWrap(
  text: string,
  start: number,
  end: number,
  kind: "bold" | "italic",
): { text: string; start: number; end: number } {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.max(a, Math.min(Math.max(start, end), text.length));
  let left = 0;
  while (left < 3 && a - left - 1 >= 0 && text[a - left - 1] === "*") left++;
  let right = 0;
  while (right < 3 && text[b + right] === "*") right++;
  const k = Math.min(left, right);
  const isOn = kind === "bold" ? k === 2 || k === 3 : k === 1 || k === 3;
  const m = kind === "bold" ? 2 : 1;
  if (isOn) {
    return { text: text.slice(0, a - m) + text.slice(a, b) + text.slice(b + m), start: a - m, end: b - m };
  }
  // Keep spaces outside the markers: "** word**" would not format.
  let s = a;
  let e = b;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  const marker = "*".repeat(m);
  return { text: text.slice(0, s) + marker + text.slice(s, e) + marker + text.slice(e), start: s + m, end: e + m };
}
