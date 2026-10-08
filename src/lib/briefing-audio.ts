import { mdToPlainText } from "./markdown";

/**
 * Build the spoken script for a briefing's "Listen" control.
 *
 * Briefings are hand-authored markdown carrying raw HTML: scoped <style>,
 * inline <svg> figures, layout <div>s and citation tables. Feeding that
 * straight to mdToPlainText is *safe* (sanitize drops <style>/<svg> with their
 * contents) but not *listenable*, for two reasons:
 *
 *   1. sanitize() strips <div> tags before mdToPlainText gets to convert
 *      "</div>" into a newline, so adjacent blocks run together mid-word
 *      ("…Freely ShareableA primary-source read…").
 *   2. Visual chrome — the cover slab, the status-card board, citation-dense
 *      tables, scroll hints — reads as a stream of disconnected fragments
 *      ("Prepared by. iKratom Policy Desk. Status as of. August 24, 2026.").
 *
 * So we drop the chrome first, force block boundaries, then hand the prose to
 * the shared plain-text converter. Anything a figure or table shows visually is
 * restated in prose in the briefings themselves, so nothing load-bearing is
 * lost — src/lib/__tests__/briefing-tts.test.ts asserts exactly that.
 */

/** Class names whose entire subtree is visual chrome, not narration. */
const CHROME_CLASSES = ["cover", "k7-board", "k7-scrollhint"];

/**
 * Inline marker standing in for a block boundary while the text passes through
 * marked + sanitize. Must contain no markdown-significant or HTML characters,
 * and nothing a briefing would ever write literally.
 */
const BLOCK_BREAK = "zzBRKzz";

/**
 * Remove `<tag ...class="...name...">…</tag>` including its full subtree,
 * counting nesting so an inner <div> can't end the match early. A regex can't
 * do this correctly — `[\s\S]*?</div>` stops at the first inner close.
 */
export function stripElementByClass(html: string, className: string, tag = "div"): string {
  const open = new RegExp(`<${tag}\\b[^>]*class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>`, "i");
  const openAny = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closeAny = new RegExp(`</${tag}\\s*>`, "gi");

  let out = html;
  // Re-run so multiple instances of the same class are all removed.
  for (let guard = 0; guard < 50; guard++) {
    const m = open.exec(out);
    if (!m) break;
    const start = m.index;
    let depth = 1;
    let cursor = start + m[0].length;
    while (depth > 0 && cursor < out.length) {
      openAny.lastIndex = cursor;
      closeAny.lastIndex = cursor;
      const nextOpen = openAny.exec(out);
      const nextClose = closeAny.exec(out);
      if (!nextClose) { cursor = out.length; break; } // unbalanced — drop the tail
      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        cursor = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        cursor = nextClose.index + nextClose[0].length;
      }
    }
    out = out.slice(0, start) + out.slice(cursor);
  }
  return out;
}

/** Expand symbols and legal abbreviations that TTS engines mangle. */
export function speakify(text: string): string {
  return text
    // Chemical formulae: C₂₃H₃₀N₂O₅ -> "C 23 H 30 N 2 O 5"
    .replace(/[₀₁₂₃₄₅₆₇₈₉]+/g, (d) =>
      " " + d.replace(/./g, (c) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(c))) + " ")
    .replace(/§+\s*/g, "Section ")
    .replace(/\bU\.S\.C\./g, "U S C")
    .replace(/\bCFR\b/g, "C F R")
    .replace(/\bFR\b/g, "Federal Register")
    .replace(/\b7-OH\b/g, "seven O H")
    .replace(/\bMGM-(\d+)/g, "M G M $1")
    .replace(/\bMP\b/g, "mitragynine pseudoindoxyl")
    .replace(/\bGC-MS\b/g, "G C mass spec")
    .replace(/\bLC-QTOF-MS\b/g, "L C Q TOF mass spec")
    .replace(/\bNOI\b/g, "notice of intent")
    .replace(/≈/g, "approximately ")
    .replace(/×/g, " times ")
    .replace(/[←→↓↑]/g, " ")
    .replace(/\s*·\s*/g, ", ")
    .replace(/\s+&\s+/g, " and ")
    .replace(/[ \t]{2,}/g, " ");
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * "2026-08-24" -> "August 24, 2026" so the voice doesn't read digits and
 * hyphens. Parsed by hand rather than via Date so no timezone can shift the
 * day (a bare `new Date("2026-08-24")` is UTC midnight and renders as the
 * 23rd for any US reader). Non-ISO input is returned unchanged.
 */
export function spokenDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${month} ${Number(m[3])}, ${m[1]}`;
}

export type BriefingAudioInput = {
  title: string;
  subtitle?: string | null;
  published?: string | null;
  /** Briefing body markdown, front matter already removed. */
  content: string;
};

/**
 * Produce the plain-text script handed to <AudioReader text={...} />.
 * Returns "" when there is nothing worth speaking.
 */
export function briefingAudioScript({ title, subtitle, published, content }: BriefingAudioInput): string {
  let body = content;

  // 1. Visual-only containers, whole subtree.
  for (const cls of CHROME_CLASSES) {
    body = stripElementByClass(body, cls, "div");
    body = stripElementByClass(body, cls, "span");
  }
  // 2. Citation-dense tables (k7-t) are unlistenable; the myth/record table
  //    (table.decode) is real content, so it stays.
  body = stripElementByClass(body, "k7-t", "table");
  // 3. Force a block boundary at every closing div/section tag, because
  //    sanitize() removes those tags before mdToPlainText can turn them into
  //    newlines — without this, adjacent blocks fuse mid-word ("ShareableA").
  //
  //    This has to be an inline *text* sentinel, not a newline. Replacing
  //    "</div>" with "\n\n" pre-parse leaves the opening tags unclosed, marked
  //    then bails out of raw-HTML mode and escapes them, and decodeEntities
  //    turns them back into literal "<div class=...>" that gets read aloud.
  //    A sentinel keeps every HTML block well-formed through the parser.
  body = body.replace(/<\/(div|section|figure)\s*>/gi, (m) => `${BLOCK_BREAK}${m}`);

  const spoken = speakify(
    mdToPlainText(body).split(BLOCK_BREAK).join("\n\n"),
  )
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!spoken) return "";

  const intro = [
    speakify(title).replace(/\.?$/, "."),
    subtitle ? speakify(subtitle).replace(/\.?$/, ".") : null,
    published
      ? `An iKratom policy briefing, published ${spokenDate(published)}.`
      : "An iKratom policy briefing.",
  ]
    .filter(Boolean)
    .join(" ");

  return `${intro}\n\n${spoken}`;
}
