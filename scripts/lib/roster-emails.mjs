/**
 * roster-emails.mjs — the pure half of the official-roster email check
 * (scripts/check-legislator-rosters.mjs).
 *
 * Why (2026-11-11): one-click letters to Michigan Rep. Parker Fairbairn bounced.
 * openstates/people, our contact source, lists parker.fairbairn@house.mi.gov;
 * the House's own roster (house.mi.gov/AllRepresentatives) lists
 * ParkerFairbairn@house.mi.gov. In Michigan, exactly the three bounced
 * addresses were the three not on that page. The chamber's own member list is
 * the authority, so we compare against it.
 *
 * Rules:
 *   - A page may change an address only when it vouches for the chamber: at
 *     least SWAP_COVERAGE of the members whose email domain appears on it are
 *     listed there exactly. Between REPORT_COVERAGE and that, its mismatches
 *     are only reported. Oregon's cited page is the 2023 session's: 75% of
 *     today's members, and it offered Sen. Diane Linthicum the address of
 *     Dennis Linthicum, who held the seat before her (first dry run, 11-16).
 *   - A member is a mismatch only when their domain is on the page and their
 *     address is not. A personal Gmail is out of scope here.
 *   - A swap needs exactly ONE address on the page, on the member's own domain,
 *     that carries their surname at the start or end of a part of the local
 *     name (kathleen.smith@ never matches "Lee"). Whatever else the local name
 *     holds must be a title (rep., sen.) or the member's own first name, a
 *     short form of it (tim / timothy) or its initial, so a relative with the
 *     same surname never fits (Sen.DennisLinthicum@ is not Diane's). It must
 *     not belong to another member and must not be one our checkers already
 *     rejected on this row.
 *     Anything else is reported, never cleared.
 */

export const SWAP_COVERAGE = 0.9;
export const REPORT_COVERAGE = 0.6;
export const MIN_LISTED = 5;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "esq"]);
/** Local-name parts that are a title or a chamber, not a name. */
const TITLES = new Set(["rep", "reps", "representative", "sen", "senator", "asm", "assembly", "assemblymember", "del", "delegate", "house", "senate", "leg", "office", "hon", "councilmember", "cm"]);

/** Fold accents and keep letters only: "Núñez-Ruiz" -> "nunezruiz". */
export const letters = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Every address on a page, keyed lowercase -> the page's own spelling.
 * Expects HTML that already went through decodeCfEmails; also undoes the
 * entity and %40 encodings rosters use to hide an "@" from scrapers.
 */
export function extractEmails(html) {
  const text = String(html ?? "")
    .replace(/&#(?:64|x40);/gi, "@").replace(/&#(?:46|x2e);/gi, ".").replace(/%40/g, "@")
    .replace(/mailto:/gi, " ");
  const out = new Map();
  for (const m of text.match(EMAIL_RE) ?? []) {
    const e = m.replace(/^[._%+-]+|[._%+-]+$/g, "");
    const key = e.toLowerCase();
    if (!out.has(key)) out.set(key, e);
  }
  return out;
}

export const domainOf = (email) => String(email ?? "").split("@").pop().trim().toLowerCase();

/**
 * Surname forms to look for in an address: the whole family name run together
 * ("vanwoerkom") and its last word ("woerkom"), each at least 3 letters. Falls
 * back to the last word of the full name, skipping suffixes like "Jr.".
 */
export function surnameKeys(familyName, fullName) {
  let words = String(familyName ?? "").trim().split(/[\s-]+/).filter(Boolean);
  if (!words.length) {
    words = String(fullName ?? "").replace(/,.*$/, "").trim().split(/\s+/).filter((w) => !SUFFIXES.has(letters(w)));
    words = words.slice(-1);
  }
  const keys = [letters(words.join("")), letters(words.at(-1))].filter((k) => k.length >= 3);
  return [...new Set(keys)];
}

/** Does this address carry the surname at the start or end of a local-name part? */
export function carriesSurname(email, keys) {
  const parts = String(email).split("@")[0].toLowerCase().split(/[._+-]+/).map(letters).filter(Boolean);
  return keys.some((k) => parts.some((p) => p.startsWith(k) || p.endsWith(k)));
}

/** The member's first names, letters only: every word of the full name that is not the surname or a suffix. */
export function givenNames(fullName, givenName, keys) {
  const words = `${givenName ?? ""} ${String(fullName ?? "").replace(/,.*$/, "")}`.split(/\s+/).map(letters)
    .filter((w) => w && !SUFFIXES.has(w) && !keys.includes(w));
  return [...new Set(words)];
}

const fitsGiven = (part, given) => given.some((g) => part === g
  || (part.length === 1 && g.startsWith(part))
  || (Math.min(part.length, g.length) >= 3 && (g.startsWith(part) || part.startsWith(g))));

/**
 * Is everything in the local name besides the surname a title or the member's
 * own first name? "ParkerFairbairn" fits Parker Fairbairn; "Sen.DennisLinthicum"
 * does not fit Diane Linthicum; "SenElect.JeffHelfrich" does not fit anyone.
 */
export function nameFits(email, keys, given) {
  const parts = String(email).split("@")[0].toLowerCase().split(/[._+-]+/).map(letters).filter(Boolean);
  for (const p of parts) {
    if (TITLES.has(p)) continue;
    const key = keys.find((k) => p.startsWith(k) || p.endsWith(k));
    const rest = key ? (p.startsWith(key) ? p.slice(key.length) : p.slice(0, p.length - key.length)) : p;
    if (rest && !TITLES.has(rest) && !fitsGiven(rest, given)) return false;
  }
  return true;
}

/** Addresses on the page, on `domain`, that carry the surname. */
export function surnameHits(pageEmails, keys, domain) {
  if (!keys.length) return [];
  return [...pageEmails.keys()].filter((e) => domainOf(e) === domain && carriesSurname(e, keys));
}

/** Normalise a source URL so variants of one page collapse: no hash, no trailing slash. */
export function pageKey(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = "";
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch { return null; }
}

/**
 * Candidate roster pages for one chamber, best first: sources noted as a
 * members/legislator list, and any URL many of the chamber's members share
 * (a page every member cites is the list, whatever its note says).
 * @param {{ sources?: { url: string, note?: string }[] }[]} members  the chamber's openstates/people docs
 */
export function rosterPages(members, { max = 3 } = {}) {
  const count = new Map();
  const noted = new Set();
  for (const m of members) {
    const seen = new Set();
    for (const s of m.sources ?? []) {
      const k = pageKey(s?.url);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      count.set(k, (count.get(k) ?? 0) + 1);
      if (/(members?|legislators?)\s+list/i.test(s.note ?? "") && !/json|api|token/i.test(s.note ?? "")) noted.add(k);
    }
  }
  const shared = Math.max(5, Math.ceil(members.length * 0.2));
  return [...count].filter(([k, n]) => noted.has(k) || n >= shared)
    .sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

/**
 * Compare one chamber's rows with one page.
 * @param {{ id: string, email: string, surnameKeys: string[], givenNames: string[], rejected: Set<string> }[]} rows
 * @param {Map<string,string>} pageEmails  from extractEmails
 * @param {Map<string,string>} takenBy     lowercase email -> row id, every active legislator in the state
 */
export function compareChamber(rows, pageEmails, takenBy) {
  const pageDomains = new Set([...pageEmails.keys()].map(domainOf));
  const inScope = rows.filter((r) => pageDomains.has(domainOf(r.email)));
  const listed = inScope.filter((r) => pageEmails.has(String(r.email).trim().toLowerCase()));
  const coverage = inScope.length ? listed.length / inScope.length : 0;
  const vouches = listed.length >= MIN_LISTED && coverage >= SWAP_COVERAGE;
  const reports = listed.length >= MIN_LISTED && coverage >= REPORT_COVERAGE;
  const mismatches = [];
  for (const r of inScope) {
    const old = String(r.email).trim().toLowerCase();
    if (pageEmails.has(old)) continue;
    const hits = surnameHits(pageEmails, r.surnameKeys, domainOf(old)).filter((e) => !r.rejected.has(e));
    const free = hits.filter((e) => !takenBy.has(e) || takenBy.get(e) === r.id);
    let swap = null, reason;
    if (!r.surnameKeys.length) reason = "surname too short to match";
    else if (!hits.length) reason = "no address on the page carries the surname";
    else if (hits.length > 1) reason = `${hits.length} addresses carry the surname`;
    else if (!free.length) reason = `${hits[0]} belongs to another member`;
    else if (!nameFits(free[0], r.surnameKeys, r.givenNames ?? [])) reason = `${pageEmails.get(free[0])} holds more than the member's own name`;
    else if (!vouches) reason = `would be ${pageEmails.get(free[0])}, but the page lists too few members to change it`;
    else { swap = pageEmails.get(free[0]); reason = "one address on the page carries the member's name"; }
    mismatches.push({ row: r, swap, reason });
  }
  return { inScope: inScope.length, listed: listed.length, coverage, vouches, reports, mismatches };
}

/** The provenance line. rejectedEmails() in legislator-contacts.mjs reads the first quoted address. */
export function correctionLine(oldEmail, newEmail, chamber, url, today) {
  return `- Email corrected ${today}: "${oldEmail}" is not on ${chamber}'s official roster (${url}); "${newEmail}" is, and it carries the member's name.`;
}
