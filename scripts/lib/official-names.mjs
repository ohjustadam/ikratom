/**
 * official-names.mjs — "is this the same official, spelled differently?"
 *
 * WHY (2026-10-07): the refresh batch inserted duplicates whenever a roster
 * page spelled a sitting official differently from our row — "Pilar Faulkner"
 * vs "Pilar F.H. Faulkner" (Santa Fe), "Jasi Mikae Edwards" vs "Jasi Edwards"
 * (Trenton), "Kenneth Jenkins" vs "Ken Jenkins" (Westchester). The same miss
 * also marked the existing row "not re-confirmed", so it went stale.
 *
 * Rule: same last name, and compatible first names (equal, a nickname of each
 * other, or one a 3+ letter prefix of the other). Middle names/initials,
 * suffixes and titles are ignored. Within one council, two DIFFERENT people
 * sharing a last name have different first names (Santa Fe's Michael and Lee
 * Garcia), so this stays precise where it is used: one locality's roster.
 */

const NICK = {
  rick: "richard", rich: "richard", dick: "richard", bob: "robert", rob: "robert", bobby: "robert",
  bill: "william", will: "william", billy: "william", jim: "james", jimmy: "james", mike: "michael",
  tom: "thomas", tony: "anthony", dave: "david", dan: "daniel", danny: "daniel", joe: "joseph",
  ken: "kenneth", kenny: "kenneth", steve: "steven", chris: "christopher", kate: "katherine",
  katie: "katherine", liz: "elizabeth", beth: "elizabeth", sandy: "sandra", sue: "susan",
  ed: "edward", ted: "edward", greg: "gregory", matt: "matthew", andy: "andrew", nick: "nicholas",
  sam: "samuel", ben: "benjamin", jen: "jennifer", jenn: "jennifer", tim: "timothy", larry: "lawrence",
  jack: "john", jeff: "jeffrey", pat: "patrick", cathy: "catherine", kathy: "katherine", don: "donald",
  // 2026-10-13 duplicates: Naperville's "Nate"/"Nathan" Wilson, Tishomingo's "Barbra"/"Barbara" Oaks.
  nate: "nathan", charlie: "charles", chuck: "charles", barbra: "barbara",
};
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "esq"]);
const TITLE = new Set(["dr", "hon", "mr", "mrs", "ms", "rev"]);

/**
 * "Silverstein, Debra L." -> "Debra L. Silverstein". Some clerk systems
 * (Chicago's Legistar) publish surname-first, and a member reading "Hall,
 * William E." on their officials page is reading a database dump. A trailing
 * suffix stays where it is: "Frank Scott, Jr." is already in reading order.
 */
export function readingOrderName(full) {
  const s = String(full ?? "").trim().replace(/\s+/g, " ");
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  const isSuffix = (p) => SUFFIX.has(p.toLowerCase().replace(/\./g, ""));
  if (parts.length === 2 && !isSuffix(parts[1])) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3 && !isSuffix(parts[1]) && isSuffix(parts[2])) return `${parts[1]} ${parts[0]}, ${parts[2]}`;
  return s;
}

/**
 * True for a title standing in for a name: "Councilmember Jones",
 * "Alderman Hall". Philadelphia's Legistar publishes some members that way,
 * and two rows for one person ("Councilmember Bass" beside "Cindy Bass") went
 * live on 2026-06-03.
 */
export function isTitleOnlyName(full) {
  return /^(council ?(member|man|woman|or|president)|alder(man|woman|person)|commissioner|supervisor|mayor|trustee|legislator|freeholder)\.?\s+[a-z'-]+\.?$/i
    .test(String(full ?? "").trim());
}

/** @returns {{ first: string, last: string } | null} */
export function nameParts(full) {
  const tokens = readingOrderName(full)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/"[^"]*"/g, " ")       // drop quoted nicknames: Cornelius "CC" Calhoun
    .replace(/[ʻʼ‘’`']/g, "") // ʻokina / apostrophes: Kiaʻāina, O'Neill
    .replace(/[^a-z\s-]/g, " ")     // keep letters and hyphens
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t && !SUFFIX.has(t) && !TITLE.has(t));
  if (tokens.length < 2) return null;
  return { first: tokens[0], last: tokens[tokens.length - 1] };
}

const canon = (n) => NICK[n] ?? n;

/** True when `a` and `b` name the same person on one roster. */
export function sameOfficial(a, b) {
  if (String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()) return true;
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x || !y || x.last !== y.last) return false;
  if (x.first === y.first || canon(x.first) === canon(y.first)) return true;
  const [s, l] = x.first.length <= y.first.length ? [x.first, y.first] : [y.first, x.first];
  return s.length >= 3 && l.startsWith(s);
}

/** First row in `rows` (objects with full_name) naming the same person as `name`. */
export function findSameOfficial(rows, name) {
  return (rows ?? []).find((r) => sameOfficial(r.full_name, name)) ?? null;
}
