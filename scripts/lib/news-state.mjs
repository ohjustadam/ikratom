// scripts/lib/news-state.mjs
//
// Which state does a news HEADLINE belong to? sync-news-rss.mjs runs one
// Google News query per state ("kratom" "Louisiana") and used to file every
// hit under that state. A query matches any article that merely mentions the
// state, so "Why did TN ban kratom?" and the Ole Miss (Mississippi) deaths,
// which mentioned the LSU game, were filed under LA, then pushed to LA members.
//
// The rule is deliberately narrow, because the broad gazetteer tiers produced
// false positives on headlines (scripts/audit-locality-states.mjs notes):
//   * the headline names the query's own state  -> keep it;
//   * it names exactly ONE other state           -> that state;
//   * anything else (none, several, ambiguous)   -> keep the query's state.
// "Names" means a full state name (not "<name> City"), an unambiguous postal
// code written as a capitalised word, or a nickname in HEADLINE_ALIASES.

import { STATE_NAMES, STATE_ABBRS, mentionedStates } from "./us-states.mjs";

// Postal codes that are also common headline words or abbreviations are never
// read as a state: IN, OR, ME, OK, HI, OH, AL, LA (Los Angeles), CO (company),
// ID, DE, MD (doctor), PA (physician assistant), MA, GA (general admission), DC.
const AMBIGUOUS_CODES = new Set(["IN", "OR", "ME", "OK", "HI", "OH", "AL", "LA", "CO", "ID", "DE", "MD", "PA", "MA", "GA", "DC"]);
const SAFE_CODES = [...STATE_ABBRS].filter((c) => !AMBIGUOUS_CODES.has(c));
const CODE_RE = new RegExp(`(?:^|[^A-Za-z.])(${SAFE_CODES.join("|")})(?=[^A-Za-z]|$)`, "g");

// Nicknames that pin a state in a headline. Keep this short and certain.
export const HEADLINE_ALIASES = [
  [/\bole miss\b/i, "MS"],
];

// "Washington" alone is DC, the state, or a town: never evidence by itself.
const AMBIGUOUS_NAMES = new Set(["WA"]);

/** States a headline spells out: full names and safe postal codes. */
function explicitStates(t) {
  const out = new Set();
  for (const st of mentionedStates(t)) if (!AMBIGUOUS_NAMES.has(st)) out.add(st);
  for (const m of t.matchAll(CODE_RE)) out.add(m[1]);
  return out;
}

/** States a headline names (full names, safe postal codes, aliases). */
export function headlineStates(title) {
  const t = String(title ?? "");
  const out = explicitStates(t);
  for (const [re, st] of HEADLINE_ALIASES) if (re.test(t)) out.add(st);
  return out;
}

/**
 * The state a headline found under `scope` belongs to. Returns `scope` unless
 * the headline leaves `scope` out and names exactly one other state. A state
 * spelled out outranks a nickname: "Why did TN ban kratom? ... after Ole Miss
 * deaths" is a Tennessee story; "Ole Miss deaths ... hosting LSU" is Mississippi.
 * @param {string} title
 * @param {string | null} scope 2-letter state the query was for, or null (federal)
 * @returns {string | null}
 */
export function newsStateFromTitle(title, scope) {
  if (!scope || !STATE_NAMES[scope]) return scope ?? null;
  const t = String(title ?? "");
  const named = headlineStates(t);
  if (named.has(scope)) return scope;
  const explicit = explicitStates(t);
  // A Washington story under WA scope is fine; under another scope it is not
  // evidence for WA (see AMBIGUOUS_NAMES), so it simply stays put.
  if (explicit.size === 1) return [...explicit][0];
  if (explicit.size === 0 && named.size === 1) return [...named][0];
  return scope;
}
