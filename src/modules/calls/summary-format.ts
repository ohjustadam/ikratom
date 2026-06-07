// src/modules/calls/summary-format.ts
// PLAIN module (not "use server"): pure formatting + validation for call
// summaries. Lives here so the quote-free public-summary guarantee is unit-
// testable (tests/call-summary-format.test.ts) — a "use server" module may
// export only async functions, so these can't live in ai-summarize.ts.

export const VALID_POSITIONS = ["supportive", "opposed", "undecided", "unclear", "not_discussed"] as const;
export type Position = (typeof VALID_POSITIONS)[number];

export type SummaryParsed = {
  summary_md?: string;
  legislator_position?: string;
  key_quotes?: string[];
  follow_up_needed?: string;
  concerns_raised_by_legislator?: string[];
};

/** Full summary — INCLUDES verbatim key quotes. PRIVATE (caller + admin only). */
export function formatSummaryMd(parsed: SummaryParsed): string {
  const blocks: string[] = [];
  if (parsed.summary_md) blocks.push(parsed.summary_md);
  if (parsed.legislator_position) blocks.push(`**Stated position:** ${parsed.legislator_position}`);
  if (parsed.key_quotes && parsed.key_quotes.length > 0) {
    blocks.push(`**Key quotes:**\n${parsed.key_quotes.map((q) => `> "${q}"`).join("\n\n")}`);
  }
  if (parsed.concerns_raised_by_legislator && parsed.concerns_raised_by_legislator.length > 0) {
    blocks.push(`**Concerns raised:** ${parsed.concerns_raised_by_legislator.join(" · ")}`);
  }
  if (parsed.follow_up_needed) blocks.push(`**Follow-up:** ${parsed.follow_up_needed}`);
  return blocks.join("\n\n");
}

/** Strip any double-quoted span (straight or curly) so a verbatim quote the
 *  model slipped into prose (rather than the key_quotes field) can't reach the
 *  public board. Defense-in-depth WITH the paraphrase-only prompt + the human
 *  moderation step — makes the quote-free guarantee structural, not just
 *  prompt-dependent. Preserves newlines (only collapses runs of spaces). */
function stripQuotedSpans(text: string): string {
  return text
    .replace(/[“”"][^“”"]*[“”"]/g, "[…]")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Public, QUOTE-FREE summary for /calls/board. Omits key_quotes AND strips any
 *  quoted span from the prose — publishing a named official's verbatim words
 *  from a private call carries wiretap-contents / publication risk the platform
 *  should not take by default. */
export function formatPublicSummaryMd(parsed: SummaryParsed): string {
  const blocks: string[] = [];
  if (parsed.summary_md) blocks.push(stripQuotedSpans(parsed.summary_md));
  if (parsed.legislator_position) blocks.push(`**Stated position:** ${parsed.legislator_position}`);
  if (parsed.concerns_raised_by_legislator && parsed.concerns_raised_by_legislator.length > 0) {
    blocks.push(`**Concerns raised:** ${stripQuotedSpans(parsed.concerns_raised_by_legislator.join(" · "))}`);
  }
  return blocks.join("\n\n");
}

export function normalizePosition(p: string | undefined): Position | null {
  const v = String(p ?? "").toLowerCase().trim();
  return (VALID_POSITIONS as readonly string[]).includes(v) ? (v as Position) : null;
}
