/**
 * BoP keyword classifier — TS twin of scripts/lib/bop-engine.mjs's
 * classify(). Kept in sync manually for now (no shared codepath
 * because the engine is .mjs and this is TS). If the regexes drift,
 * fix both.
 */

const DIRECT_RE = /\b(kratom|mitragyna|mitragynine|7-?(?:hydroxy)?(?:mitragynine)?|7-oh)\b/i;
const ADJACENT_RE = /\b(novel\s+psychoactive|emerging\s+substance|scheduling|controlled\s+substance|rule\s*23|"botanical")\b/i;
const HOSTILE_RE = /\b(ban|prohibit|schedule\s+i|add\s+to\s+schedule|controlled|adulterated|emergency\s+rule)\b/i;
const SUPPORTIVE_RE = /\b(consumer\s+protection|labeling|age\s+limit|standards|kcpa)\b/i;

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
