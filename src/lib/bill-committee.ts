/**
 * Committee-assignment parser for bill_actions.description text.
 *
 * Bill-tracking sources (OpenStates, LegiScan, state-house scrapers)
 * emit action descriptions like:
 *   "Referred to Senate Health Committee"
 *   "Action deferred in Senate Judiciary Committee to 3/25/2026"
 *   "House Recommended for passage, refer to Senate Finance, Ways, and Means Committee"
 *   "To be heard in Assembly Codes Committee"
 *
 * parseCommitteeFromAction(description) extracts the canonical name
 * (e.g. "Senate Health Committee") + chamber guess so the bill row
 * can carry a structured current_committee pointer that the UI uses
 * to cross-reference user's reps × legislator_committees rows.
 *
 * Returns null when no committee mentioned. Conservative: never
 * returns a name longer than 80 chars or shorter than 8.
 */

// Match: chamber word, then 2-80 chars NONE of which START a new
// chamber word, then "Committee". The negative lookahead is what
// prevents the regex from picking the FIRST chamber and gobbling
// across an intervening one to find the trailing "Committee" — which
// produces a span the 80-char ceiling correctly rejects anyway, but
// only after wasting backtracking. Real-world example fixed by this:
//   "House Recommended for passage, refer to Senate Finance,
//    Ways, and Means Committee"
// Without lookahead: engine starts at "House", tries to reach
// "Committee" but the captured span is 82 chars → rejected → returns
// null. With lookahead: engine skips "House" (because "Senate"
// appears in the middle), starts at "Senate Finance...", captures
// the correct 42-char committee name.
const COMMITTEE_RE =
  /((?:Senate|House|Assembly|Joint)(?:(?!Senate|House|Assembly|Joint)[^.;]){2,80}?Committee)/i;

export type ParsedCommittee = {
  name: string;
  chamber: "house" | "senate" | "joint" | null;
};

export function parseCommitteeFromAction(
  description: string | null | undefined,
): ParsedCommittee | null {
  if (!description) return null;
  const m = description.match(COMMITTEE_RE);
  if (!m) return null;
  const raw = m[1].trim();
  if (raw.length < 8 || raw.length > 80) return null;

  let chamber: ParsedCommittee["chamber"] = null;
  if (/^senate/i.test(raw)) chamber = "senate";
  else if (/^(house|assembly)/i.test(raw)) chamber = "house";
  else if (/^joint/i.test(raw)) chamber = "joint";

  return { name: raw, chamber };
}

/**
 * Loose name match for cross-referencing a bill's committee with
 * legislator_committees rows. We use lowercase + strip "Committee"
 * + collapse whitespace so e.g.
 *   "Senate Health Committee" matches "senate health"
 *   "Senate Finance, Ways, and Means Committee" matches
 *     "senate finance, ways, and means"
 *
 * Two strings match if either's normalized form is contained in the
 * other's. That tolerates slight schema drift (e.g. some sources
 * write "Sen. Health & Welfare" vs "Senate Health Committee").
 */
export function normalizeCommitteeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bcommittee\b/g, "")
    .replace(/[^\p{Letter}\p{Number}\s,&-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function committeesMatch(a: string, b: string): boolean {
  const na = normalizeCommitteeName(a);
  const nb = normalizeCommitteeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Either contained inside the other, but only if the shorter is
  // at least 8 chars (avoid e.g. "senate" matching everything).
  const short = na.length <= nb.length ? na : nb;
  const long = short === na ? nb : na;
  return short.length >= 8 && long.includes(short);
}
