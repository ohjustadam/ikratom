/**
 * BoP keyword classifier — TS twin of scripts/lib/bop-engine.mjs's
 * classify(). Kept in sync manually for now (no shared codepath
 * because the engine is .mjs and this is TS). If the regexes drift,
 * fix both.
 */

// Sync'd with scripts/lib/bop-engine.mjs. See that file's comment block
// for the rationale on why the 7-OH/hydroxy sub-parts are required.
const DIRECT_RE =
  /\b(kratom|mitragyna\w*|7\s*-?\s*OH\b|7\s*-?\s*hydroxy(?:mitragynine)?)\b/i;
const ADJACENT_RE =
  /\b(novel\s+psychoactive\s+substance|emerging\s+(?:drug|substance)|scheduling\s+petition|new\s+controlled\s+substance|botanical\s+(?:medicine|substance)|herbal\s+supplement)\b/i;
const HOSTILE_RE =
  /\b(ban|prohibit|add\s+to\s+schedule|emergency\s+rule|criminaliz|adulterated|illegal\s+drug)\b/i;
const SUPPORTIVE_RE =
  /\b(consumer\s+protection|labeling|age\s+limit|kratom\s+consumer\s+protection|kcpa)\b/i;

export type BopRelevance = "kratom_direct" | "kratom_adjacent" | "unrelated";
export type BopSeverity =
  | "hostile_proposal"
  | "discussion_only"
  | "supportive"
  | "neutral"
  | "unknown";

export function classifyBopText(parts: (string | null | undefined)[]): {
  relevance: BopRelevance;
  severity: BopSeverity;
} {
  const text = parts.filter(Boolean).join(" ");
  let relevance: BopRelevance = "unrelated";
  if (DIRECT_RE.test(text)) relevance = "kratom_direct";
  else if (ADJACENT_RE.test(text)) relevance = "kratom_adjacent";

  let severity: BopSeverity = "unknown";
  if (relevance !== "unrelated") {
    if (HOSTILE_RE.test(text)) severity = "hostile_proposal";
    else if (SUPPORTIVE_RE.test(text)) severity = "supportive";
    else severity = "discussion_only";
  }
  return { relevance, severity };
}
