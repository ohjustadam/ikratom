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

// Form A — `<Chamber> <Body> Committee`:
//   "Senate Health Committee"
//   "Senate Finance, Ways, and Means Committee"
//   "Assembly Codes Committee"
// Negative lookahead in the inner span prevents the regex from
// gobbling across an intervening chamber word (e.g. "House
// Recommended for passage, refer to Senate Finance, Ways, and Means
// Committee" — engine skips "House" and locks onto "Senate Finance").
const COMMITTEE_RE_FORM_A =
  /((?:Senate|House|Assembly|Joint)(?:(?!Senate|House|Assembly|Joint)[^.;]){2,80}?Committee)/i;

// Form B — `<Chamber> Committee on <Body>`:
//   "Senate Committee on Healthcare"
//   "House Committee on Public Health"
//   "Senate Committee on Judiciary B"
// Distinct from Form A and far more common in OpenStates last_action
// text. Body is bounded by 1-60 chars ending at the next punctuation
// or end-of-string. The captured body is rewritten to "<Chamber>
// <Body> Committee" by parseCommitteeFromAction so the stored
// canonical name matches what legislator_committees rows look like.
const COMMITTEE_RE_FORM_B =
  /(Senate|House|Assembly|Joint)\s+Committee\s+on\s+((?:(?!Senate|House|Assembly|Joint)[^.;,]){2,60}?)(?=\s*[.;,]|$)/i;

export type ParsedCommittee = {
  name: string;
  chamber: "house" | "senate" | "joint" | null;
};

export function parseCommitteeFromAction(
  description: string | null | undefined,
): ParsedCommittee | null {
  if (!description) return null;

  // Try Form A first (most common from LegiScan + most action verbiage)
  const a = description.match(COMMITTEE_RE_FORM_A);
  if (a) {
    const raw = a[1].trim();
    if (raw.length >= 8 && raw.length <= 80) {
      let chamber: ParsedCommittee["chamber"] = null;
      if (/^senate/i.test(raw)) chamber = "senate";
      else if (/^(house|assembly)/i.test(raw)) chamber = "house";
      else if (/^joint/i.test(raw)) chamber = "joint";
      return { name: raw, chamber };
    }
  }

  // Fall back to Form B (common in OpenStates last_action snapshots:
  // "Read for the first time and referred to the Senate Committee on Healthcare")
  // Rewrite to canonical "Chamber Body Committee" form so the matcher
  // can cross-reference legislator_committees rows uniformly.
  const b = description.match(COMMITTEE_RE_FORM_B);
  if (b) {
    const chamberRaw = b[1].trim();
    const body = b[2].trim().replace(/\s+/g, " ");
    if (body.length >= 3 && body.length <= 60) {
      const chamberCanonical =
        /^senate/i.test(chamberRaw) ? "Senate"
        : /^(house|assembly)/i.test(chamberRaw) ? chamberRaw[0].toUpperCase() + chamberRaw.slice(1).toLowerCase()
        : "Joint";
      const name = `${chamberCanonical} ${body} Committee`;
      if (name.length >= 8 && name.length <= 80) {
        const chamber: ParsedCommittee["chamber"] =
          /^senate/i.test(chamberRaw) ? "senate"
          : /^(house|assembly)/i.test(chamberRaw) ? "house"
          : "joint";
        return { name, chamber };
      }
    }
  }

  return null;
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
