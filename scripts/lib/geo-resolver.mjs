// scripts/lib/geo-resolver.mjs
//
// DETERMINISTIC place -> state resolver. The permanent fix for wrong-state
// labels (Reno County != NV, Normal != RI, "FDA ..." != a state). A place's
// state is a FACT, not an LLM/scrape guess — so we look it up in the
// authoritative US Census gazetteer (scripts/lib/geo/*.json) instead of
// trusting whatever bucket a syndicated story was scraped under.
//
// Core guarantee: we NEVER emit a state the gazetteer contradicts. When the
// evidence pins exactly one state we use it (overriding a wrong guess); when
// the story is clearly federal we return FED; when we cannot confirm a single
// state we fall back to ALL (national) — never a guessed wrong state.
//
// Used by every state-assignment path (news classifier, alert/meeting/officials
// extraction) via reconcileLocality(), and by the daily self-healing audit
// (scripts/audit-locality-states.mjs).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STATE_ABBRS, STATE_NAMES } from "./us-states.mjs";
// Re-export so callers can get everything locality-related from one module.
export { STATE_ABBRS, STATE_NAMES, mentionedStates } from "./us-states.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COUNTIES = JSON.parse(fs.readFileSync(path.join(HERE, "geo", "us-counties.json"), "utf8"));
const PLACES = JSON.parse(fs.readFileSync(path.join(HERE, "geo", "us-places.json"), "utf8"));

export function normName(s) {
  return String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Span-aware full-state-name detection. Longest names first AND we blank each
// match so a substring can't double-count (e.g. "West Virginia" must yield only
// WV, never {WV, VA}). High precision: a spelled-out state name is hard signal.
const NAME_ENTRIES = Object.entries(STATE_NAMES)
  .map(([abbr, name]) => [name.toLowerCase(), abbr])
  .sort((a, b) => b[0].length - a[0].length);
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function fullStateNames(text) {
  let t = ` ${String(text ?? "").toLowerCase()} `;
  const found = new Set();
  for (const [name, abbr] of NAME_ENTRIES) {
    const re = new RegExp(`(^|[^a-z])${escRe(name)}(?!\\s+city\\b)(?=[^a-z]|$)`, "i");
    if (re.test(t)) { found.add(abbr); t = t.split(name).join(" ".repeat(name.length)); }
  }
  return found;
}

// A state named only COMPARATIVELY ("Suffolk should follow Washington's lead")
// is a model being cited, not the story's locality. Skip full-state-name in
// that case unless the same state also appears as the subject.
const COMP_CUES = "(follow|follows|following|like|unlike|than|such as|lead of|example of|modeled after|modeled on|similar to|compared to|mirror|mirrors|emulate|emulates)";
function appearsOnlyComparatively(text, stateName) {
  const t = ` ${String(text).toLowerCase()} `;
  const esc = stateName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const comp = new RegExp(`${COMP_CUES}\\s+(the\\s+)?(\\w+\\s+){0,2}${esc}\\b|\\b${esc}'?s\\s+(lead|example|model|approach|playbook|footsteps)`, "i");
  if (!comp.test(t)) return false;
  const subj = new RegExp(`\\b${esc}\\b\\s*('?s)?\\s*(lawmaker|legislat|house|senate|governor|gov\\b|bill|ban|passed|signed|ag\\b|attorney|rep\\b|representative|enact|approv|introduc|criminaliz|panel|committee)|\\bin\\s+${esc}\\b|\\b${esc}\\s+(is|will|has|moves|considers|begins)`, "i");
  return !subj.test(t);
}

// Clearly-federal signals: when present (and no single state is pinned) the
// story belongs to the national level, not whatever state-bucket scraped it.
const FEDERAL_RE = /\b(f\.?d\.?a\.?|food and drug admin\w*|d\.?e\.?a\.?|drug enforcement|justice department|dept\.? of justice|d\.?o\.?j\.?|f\.?t\.?c\.?|congress(ional)?|u\.?s\.? senate|u\.?s\.? house|house of representatives|federal\w*|nationwide|national(ly)? ban|schedule [iv]+\b|controlled substances act|\bcsa\b|\bhhs\b|\bnida\b|\bsamhsa\b|white house|capitol hill|supreme court)\b/i;

const COUNTY_RE = /\b([A-Z][A-Za-z.''’-]+(?:\s+[A-Z][A-Za-z.''’-]+){0,3})\s+(County|Parish|Borough|Census Area)\b/g;
const CITY_ST_RE = /\b([A-Z][A-Za-z.''’-]+(?:\s+[A-Z][A-Za-z.''’-]+){0,3}),\s*([A-Z]{2})\b/g;
// Runs of consecutive Capitalized tokens (for bare place lookup).
const CAP_RUN_RE = /\b([A-Z][A-Za-z.''’-]+(?:\s+[A-Z][A-Za-z.''’-]+){0,3})\b/g;

// Words that are common English/org/name tokens AND happen to be a Census
// place unique to one state — exclude from single-token bare matching so prose
// like "Mobile app" or a person's first name can't fabricate a state. (Genuine
// city stories still resolve via "City, ST", county, full state name, or a
// second corroborating place mention.)
const BARE_STOPWORDS = new Set([
  // common-noun towns that collide with prose
  "mobile", "industry", "commerce", "liberty", "union", "surprise", "sandwich",
  "boring", "why", "accident", "hazard", "energy", "eureka", "enterprise",
  "protection", "security", "general", "early", "ordinary", "frankfort",
  // civic/government org words that are ALSO tiny incorporated places
  // (e.g. "Council, ID") — these are never the target locality, only noise.
  "council", "committee", "board", "commission", "department", "authority",
  "district", "court", "senate", "house", "assembly", "legislature", "cabinet",
  "mayor", "governor", "sheriff", "police", "health", "ordinance", "city",
  "town", "village", "borough", "county", "state", "council's", "buena vista",
]);

function lookup(name) {
  // counties keyed WITH the type word; places keyed bare.
  return PLACES[name] || null;
}

/** Extract all geographic evidence from a blob of text. */
export function extractEvidence(text) {
  const t = String(text ?? "");
  const fullNames = fullStateNames(t); // Set of abbrs whose FULL state name appears (span-aware)

  const counties = [];
  for (const m of t.matchAll(COUNTY_RE)) {
    const key = normName(`${m[1]} ${m[2]}`)
      .replace(/\bcensus area\b/, "census area");
    const states = COUNTIES[key];
    if (states) counties.push({ name: key, states });
  }

  const cityST = [];
  for (const m of t.matchAll(CITY_ST_RE)) {
    const place = normName(m[1]);
    const st = m[2].toUpperCase();
    if (!STATE_ABBRS.has(st)) continue;
    const states = PLACES[place] || COUNTIES[place] || COUNTIES[`${place} county`];
    cityST.push({ name: place, st, ok: !!states && states.includes(st) });
  }

  // Bare place mentions: scan capitalized runs, longest sub-n-gram first.
  // Any n-gram containing a civic/org stopword token is skipped, so prose like
  // "Rome City Commission" can't spuriously match "Rome City, IN".
  const bare = [];
  const seen = new Set();
  for (const m of t.matchAll(CAP_RUN_RE)) {
    const tokens = m[1].split(/\s+/);
    for (let len = Math.min(4, tokens.length); len >= 1; len--) {
      for (let i = 0; i + len <= tokens.length; i++) {
        const sub = tokens.slice(i, i + len).map((x) => normName(x));
        if (sub.some((tok) => BARE_STOPWORDS.has(tok))) continue;
        const phrase = sub.join(" ");
        if (seen.has(phrase)) continue;
        if (len === 1 && phrase.length < 4) continue;
        const states = lookup(phrase);
        if (states) { bare.push({ name: phrase, states, multiWord: len > 1 }); seen.add(phrase); }
      }
    }
  }

  return { fullNames, counties, cityST, bare, federal: FEDERAL_RE.test(t) };
}

function uniq(arr) { return [...new Set(arr)]; }
function intersect(sets) {
  if (!sets.length) return [];
  return sets.reduce((acc, s) => acc.filter((x) => s.includes(x)));
}

/**
 * Resolve the true locality for a story.
 * @returns {{ locality: string, corroborated: boolean, confidence: 'high'|'medium'|'low', reason: string }}
 *   locality is a 2-letter code, 'FED', or 'ALL'.
 */
export function resolveLocality({ title = "", text = "", candidateState = null } = {}) {
  const blob = `${title} ${text}`.trim();
  const cand = String(candidateState ?? "").toUpperCase().trim() || null;
  const ev = extractEvidence(blob);

  // ---- Tiered single-state determinations (strongest first) ----
  // 1. Exactly one full state NAME spelled out in the text.
  if (ev.fullNames.size === 1) {
    const st = [...ev.fullNames][0];
    if (!appearsOnlyComparatively(blob, STATE_NAMES[st])) {
      return { locality: st, corroborated: st === cand, confidence: "high", reason: `full-state-name:${st}` };
    }
  }
  // 2. A consistent "City, ST" pair pinning exactly one state.
  const okST = uniq(ev.cityST.filter((p) => p.ok).map((p) => p.st));
  if (okST.length === 1) {
    return { locality: okST[0], corroborated: okST[0] === cand, confidence: "high", reason: `city-state:${okST[0]}` };
  }
  // 3. A county whose name is unique to one state.
  const uCounty = uniq(ev.counties.filter((c) => c.states.length === 1).map((c) => c.states[0]));
  if (uCounty.length === 1) {
    return { locality: uCounty[0], corroborated: uCounty[0] === cand, confidence: "high", reason: `county:${uCounty[0]}` };
  }
  // 4. Two or more DISTINCT place/county mentions that intersect to exactly one
  //    state (e.g. "Normal" + "Bloomington" -> IL). Agreement of >=2 names is
  //    reliable even when each name alone is ambiguous.
  const interSets = [...ev.counties, ...ev.bare].map((x) => x.states);
  if (interSets.length >= 2) {
    const inter = intersect(interSets);
    if (inter.length === 1) {
      return { locality: inter[0], corroborated: inter[0] === cand, confidence: "high", reason: `intersection:${inter[0]}` };
    }
  }
  // 5. A MULTI-WORD bare place unique to one state (e.g. "Sterling Heights" ->
  //    MI). Single-word names are deliberately NOT used alone — they collide
  //    with surnames/common words ("Suffolk", "Brennan") and caused false
  //    overrides; they only count via the intersection rule above.
  const uMulti = uniq(ev.bare.filter((b) => b.multiWord && b.states.length === 1).map((b) => b.states[0]));
  if (uMulti.length === 1) {
    return { locality: uMulti[0], corroborated: uMulti[0] === cand, confidence: "high", reason: `place:${uMulti[0]}` };
  }
  // 6. Clearly federal -> national level.
  if (ev.federal) {
    return { locality: "FED", corroborated: cand === "FED", confidence: "high", reason: "federal-signal" };
  }
  // 7. Candidate contradicted by HIGH-PRECISION evidence only — an explicit
  //    "<X> County" mention or a "City, ST" pair whose state-set excludes the
  //    candidate. (Never from a lone single-word name.) Can't pin one -> ALL.
  const hardUnion = uniq([...ev.counties.flatMap((c) => c.states), ...ev.cityST.filter((p) => p.ok).map((p) => p.st)]);
  if (cand && STATE_ABBRS.has(cand) && hardUnion.length && !hardUnion.includes(cand)) {
    return { locality: "ALL", corroborated: false, confidence: "medium", reason: `candidate ${cand} contradicted by [${hardUnion.join(",")}]` };
  }
  // 8. Nothing to override with — keep the candidate (don't make it worse).
  if (cand === "FED") return { locality: "FED", corroborated: true, confidence: "low", reason: "kept:fed" };
  if (cand === "ALL") return { locality: "ALL", corroborated: true, confidence: "low", reason: "kept:all" };
  if (cand && STATE_ABBRS.has(cand)) return { locality: cand, corroborated: true, confidence: "low", reason: "kept:candidate-no-evidence" };
  return { locality: "ALL", corroborated: true, confidence: "low", reason: "no-locality" };
}

/**
 * Drop-in upgrade of the old us-states.reconcileLocality({aiLocality, scopeState, text}).
 * Now gazetteer-backed: the AI's guess is just the candidate; the gazetteer decides.
 */
export function reconcileLocality({ aiLocality, scopeState, text, title } = {}) {
  const r = resolveLocality({ title: title ?? "", text: text ?? "", candidateState: aiLocality ?? scopeState ?? null });
  return { locality: r.locality, corroborated: r.corroborated, confidence: r.confidence, reason: r.reason };
}
