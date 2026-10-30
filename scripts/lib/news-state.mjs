// scripts/lib/news-state.mjs
//
// Which state does a news story belong to? sync-news-rss.mjs runs one Google
// News query per state ("kratom" "Louisiana") and used to file every hit under
// that state. A query matches any article that merely mentions the state, so
// "Why did TN ban kratom?" and the Ole Miss (Mississippi) deaths, which
// mentioned the LSU game, were filed under LA, then pushed to LA members.
//
// Two passes. At insert, the HEADLINE (newsStateFromTitle):
//   * the headline names the query's own state  -> keep it;
//   * it names exactly ONE other state           -> that state;
//   * anything else (none, several, ambiguous)   -> keep the query's state.
// Once the article body is extracted, a headline that named NO state can be
// moved by the body (newsStateFromBody): "Oxford police investigate 2
// university student deaths" names a city, not a state.
//
// "Names" means a full state name (not "<name> City" or "<name> River"), an AP
// abbreviation ("Pa.", "Oxford, Miss."), a plural demonym ("Kansans"), an
// unambiguous postal code written as a capitalised word (headlines only), or a
// nickname in HEADLINE_ALIASES. The broad gazetteer tiers are deliberately not
// used: they produced false positives on headlines
// (scripts/audit-locality-states.mjs notes).

import { STATE_NAMES, STATE_ABBRS } from "./us-states.mjs";

// Postal codes that are also common headline words or abbreviations are never
// read as a state: IN, OR, ME, OK, HI, OH, AL, LA (Los Angeles), CO (company),
// ID, DE, MD (doctor), PA (physician assistant), MA, GA (general admission), DC.
const AMBIGUOUS_CODES = new Set(["IN", "OR", "ME", "OK", "HI", "OH", "AL", "LA", "CO", "ID", "DE", "MD", "PA", "MA", "GA", "DC"]);
const SAFE_CODES = [...STATE_ABBRS].filter((c) => !AMBIGUOUS_CODES.has(c));
const CODE_RE = new RegExp(`(?:^|[^A-Za-z.])(${SAFE_CODES.join("|")})(?=[^A-Za-z]|$)`, "g");
// Any code is a state after "<Place>, " in a headline: "Castle Rock, CO bans".
// Not before an apostrophe: "..., OK's manufacturing site" means approves.
const PLACE_CODE_RE = new RegExp(`(?<=[A-Z][A-Za-z.'-]*), (${[...STATE_ABBRS].join("|")})(?![A-Za-z'’])`, "g");

// Nicknames that pin a state in a headline. Keep this short and certain.
export const HEADLINE_ALIASES = [
  [/\bole miss\b/i, "MS"],
];

// "Washington" alone is DC, the state, or a town: never evidence by itself.
const AMBIGUOUS_NAMES = new Set(["WA", "DC"]);

// AP style, as wire copy and headlines write states. "Del." is left out: it is
// the title of a Virginia or Maryland delegate. "U.Va." is the university.
const AP_ABBRS = {
  "Ala.": "AL", "Ariz.": "AZ", "Ark.": "AR", "Calif.": "CA", "Colo.": "CO", "Conn.": "CT",
  "Fla.": "FL", "Ga.": "GA", "Ill.": "IL", "Ind.": "IN", "Kan.": "KS", "Ky.": "KY",
  "La.": "LA", "Md.": "MD", "Mass.": "MA", "Mich.": "MI", "Minn.": "MN", "Miss.": "MS",
  "Mo.": "MO", "Mont.": "MT", "Neb.": "NE", "Nev.": "NV", "N.H.": "NH", "N.J.": "NJ",
  "N.M.": "NM", "N.Y.": "NY", "N.C.": "NC", "N.D.": "ND", "Okla.": "OK", "Ore.": "OR",
  "Pa.": "PA", "R.I.": "RI", "S.C.": "SC", "S.D.": "SD", "Tenn.": "TN", "U.Va.": "VA",
  "Va.": "VA", "Vt.": "VT", "Wash.": "WA", "W.Va.": "WV", "Wis.": "WI", "Wyo.": "WY",
};

// Plurals only: "The Tennessean" and "The Oregonian" are newspapers.
const DEMONYMS = {
  Alabamians: "AL", Arizonans: "AZ", Arkansans: "AR", Californians: "CA", Coloradans: "CO",
  Floridians: "FL", Hoosiers: "IN", Iowans: "IA", Kansans: "KS", Kentuckians: "KY",
  Louisianans: "LA", Louisianians: "LA", Michiganders: "MI", Minnesotans: "MN",
  Mississippians: "MS", Missourians: "MO", Nebraskans: "NE", Nevadans: "NV",
  "New Yorkers": "NY", "New Jerseyans": "NJ", Ohioans: "OH", Oklahomans: "OK",
  Oregonians: "OR", Pennsylvanians: "PA", Tennesseans: "TN", Texans: "TX", Utahns: "UT",
  Virginians: "VA", "West Virginians": "WV", Wisconsinites: "WI",
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first, so "West Virginia" is consumed before "Virginia" can match.
const longestFirst = (words) => [...words].sort((a, b) => b.length - a.length).map(esc).join("|");
const NAME_TO_STATE = Object.fromEntries(
  Object.entries(STATE_NAMES).filter(([st]) => !AMBIGUOUS_NAMES.has(st)).map(([st, name]) => [name.toLowerCase(), st]),
);
const NAME_RE = new RegExp(`(?<![a-z])(${longestFirst(Object.keys(NAME_TO_STATE))})(?![a-z])(?!\\s+(?:city|river)\\b)`, "gi");
const AP_RE = new RegExp(`(?<![A-Za-z.])(${longestFirst(Object.keys(AP_ABBRS))})(?![A-Za-z])`, "g");
const DEMONYM_RE = new RegExp(`(?<![A-Za-z])(${longestFirst(Object.keys(DEMONYMS))})(?![A-Za-z])`, "g");

/** States the text names: full names, AP abbreviations, demonyms. */
function namedStates(text) {
  const out = new Set();
  for (const m of text.matchAll(NAME_RE)) out.add(NAME_TO_STATE[m[1].toLowerCase()]);
  for (const m of text.matchAll(AP_RE)) out.add(AP_ABBRS[m[1]]);
  for (const m of text.matchAll(DEMONYM_RE)) out.add(DEMONYMS[m[1]]);
  return out;
}

/** States a headline spells out: namedStates plus postal codes it can trust. */
function explicitStates(t) {
  const out = namedStates(t);
  for (const m of t.matchAll(CODE_RE)) out.add(m[1]);
  for (const m of t.matchAll(PLACE_CODE_RE)) out.add(m[1]);
  return out;
}

/** States a headline names (everything explicitStates reads, plus aliases). */
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

// National papers named for a city: their name says nothing about the story.
const NATIONAL_OUTLET_RE = /^(the )?(new york|washington) (times|post|daily news|examiner)\b/i;

/**
 * The state a story belongs to once its body is in. A headline that names a
 * state decides (newsStateFromTitle). One that names none can be moved, but
 * only on strong evidence, because local outlets rarely name their own state
 * and some pages carry other stories' text (a TV site's "KSLA is LIVE at the
 * State Fair of Louisiana" promos). Evidence is counted in PARAGRAPHS that
 * name a state, not mentions, and nicknames don't count: "Ole Miss" is in
 * every story about the deaths, wherever it happened.
 *   * one other state is named in at least 3 paragraphs, and more than 3x as
 *     many as any other state, the query's own state included; or
 *   * the outlet's name spells out one other state ("Mississippi Today"), and
 *     an extracted body never names the query's state, or names the outlet's state
 *     in more than twice as many paragraphs (an LSU aside in an Oxford story).
 * Replayed 2026-10-29 over 90 days (4,235 stories): see the PR.
 * @param {{ title: string, paragraphs?: string[] | null, source?: string | null, scope: string | null }} story
 * @returns {string | null}
 */
export function newsStateFromBody({ title, paragraphs, source, scope }) {
  if (!scope || !STATE_NAMES[scope] || headlineStates(title).size) return newsStateFromTitle(title, scope);
  const paras = (paragraphs ?? []).map(String);
  const counts = paragraphCounts(paras);
  const own = counts.get(scope) ?? 0;
  const others = [...counts].filter(([st]) => st !== scope).sort((a, b) => b[1] - a[1]);
  const [top, n] = others[0] ?? [null, 0];
  if (n >= 3 && n > 3 * Math.max(own, others[1]?.[1] ?? 0)) return top;
  const src = String(source ?? "");
  const outlet = NATIONAL_OUTLET_RE.test(src) ? [] : [...namedStates(src)];
  const extracted = paras.some((p) => p.trim());
  if (extracted && outlet.length === 1 && outlet[0] !== scope && (own === 0 || (outlet[0] === top && n > 2 * own))) return outlet[0];
  return scope;
}

/** How many paragraphs name each state. */
function paragraphCounts(paragraphs) {
  const counts = new Map();
  for (const p of paragraphs ?? []) for (const st of namedStates(String(p))) counts.set(st, (counts.get(st) ?? 0) + 1);
  return counts;
}

// A body names a state when 3+ paragraphs do: the bar newsStateFromBody uses
// to move a story, so one passing LSU or "State Fair of Louisiana" line is not
// enough to put a story in front of a state's members.
const MENTION_PARAGRAPHS = 3;

/**
 * The OTHER states a story is about (news_items.mentioned_states): named in
 * its headline, or in 3+ paragraphs of its body. Sorted; never `primary`.
 * @param {{ title: string, paragraphs?: string[] | null, primary: string | null }} story
 * @returns {string[]}
 */
export function newsStatesMentioned({ title, paragraphs, primary }) {
  const out = new Set(headlineStates(title));
  for (const [st, n] of paragraphCounts(paragraphs)) if (n >= MENTION_PARAGRAPHS) out.add(st);
  out.delete(primary);
  return [...out].filter((st) => STATE_NAMES[st]).sort();
}

// Past this many states a story is national coverage ("where is kratom still
// legal?"): its home state gets the push, everyone else the daily digest,
// rather than a push to half the country.
export const MAX_PUSH_STATES = 4;

/**
 * The states whose members get a story as its own push: its home state plus
 * the states it is about. The home state is dropped when the headline names
 * states and leaves it out ("Texas and Tennessee move on kratom" found by the
 * Louisiana query). A federal story (no state) goes to the states it is about
 * ("Kratom products linked to 4 deaths in Utah"); every member also sees it
 * in the national digest.
 * push-state-news.mjs sends to these; push-national-news-digest.mjs leaves
 * them out of each member's digest so nobody gets the same story twice.
 * @param {{ title: string, state: string | null, mentioned_states?: string[] | null }} item
 * @returns {string[]}
 */
export function newsPushStates({ title, state, mentioned_states }) {
  const named = headlineStates(title);
  const home = !state || (named.size > 0 && !named.has(state)) ? [] : [state];
  const all = [...new Set([...home, ...(mentioned_states ?? [])])];
  return all.length > MAX_PUSH_STATES ? home : all;
}
