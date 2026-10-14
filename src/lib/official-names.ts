/**
 * "Is this the same official, spelled differently?" — the in-app twin of
 * scripts/lib/official-names.mjs (the scripts can't import TypeScript, and the
 * app keeps its helpers typed). tests/official-names-parity.test.ts runs both
 * over the same cases, so the two cannot drift apart.
 *
 * Rule: same last name, and compatible first names (equal, a nickname of each
 * other, or one a 3+ letter prefix of the other). Middle names/initials,
 * suffixes and titles are ignored. Precise where it is used: one locality's
 * roster, where two different people sharing a surname have different first
 * names.
 */

const NICK: Record<string, string> = {
  rick: "richard", rich: "richard", dick: "richard", bob: "robert", rob: "robert", bobby: "robert",
  bill: "william", will: "william", billy: "william", jim: "james", jimmy: "james", mike: "michael",
  tom: "thomas", tony: "anthony", dave: "david", dan: "daniel", danny: "daniel", joe: "joseph",
  ken: "kenneth", kenny: "kenneth", steve: "steven", chris: "christopher", kate: "katherine",
  katie: "katherine", liz: "elizabeth", beth: "elizabeth", sandy: "sandra", sue: "susan",
  ed: "edward", ted: "edward", greg: "gregory", matt: "matthew", andy: "andrew", nick: "nicholas",
  sam: "samuel", ben: "benjamin", jen: "jennifer", jenn: "jennifer", tim: "timothy", larry: "lawrence",
  jack: "john", jeff: "jeffrey", pat: "patrick", cathy: "catherine", kathy: "katherine", don: "donald",
  nate: "nathan", charlie: "charles", chuck: "charles", barbra: "barbara",
};
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v", "phd", "md", "esq"]);
const TITLE = new Set(["dr", "hon", "mr", "mrs", "ms", "rev"]);

/** "Silverstein, Debra L." -> "Debra L. Silverstein"; "Frank Scott, Jr." stays. */
export function readingOrderName(full: string | null | undefined): string {
  const s = String(full ?? "").trim().replace(/\s+/g, " ");
  const parts = s.split(/\s*,\s*/).filter(Boolean);
  const isSuffix = (p: string) => SUFFIX.has(p.toLowerCase().replace(/\./g, ""));
  if (parts.length === 2 && !isSuffix(parts[1])) return `${parts[1]} ${parts[0]}`;
  if (parts.length === 3 && !isSuffix(parts[1]) && isSuffix(parts[2])) return `${parts[1]} ${parts[0]}, ${parts[2]}`;
  return s;
}

export function nameParts(full: string | null | undefined): { first: string; last: string } | null {
  const tokens = readingOrderName(full)
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // é → e
    .toLowerCase()
    .replace(/"[^"]*"/g, " ") // drop quoted nicknames: Cornelius "CC" Calhoun
    .replace(/[ʻʼ‘’`']/g, "") // ʻokina / apostrophes: Kiaʻāina, O'Neill
    .replace(/[^a-z\s-]/g, " ") // keep letters and hyphens
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t && !SUFFIX.has(t) && !TITLE.has(t));
  if (tokens.length < 2) return null;
  return { first: tokens[0], last: tokens[tokens.length - 1] };
}

const canon = (n: string) => NICK[n] ?? n;

/** True when `a` and `b` name the same person on one roster. */
export function sameOfficial(a: string | null | undefined, b: string | null | undefined): boolean {
  if (String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase()) return true;
  const x = nameParts(a);
  const y = nameParts(b);
  if (!x || !y || x.last !== y.last) return false;
  if (x.first === y.first || canon(x.first) === canon(y.first)) return true;
  const [s, l] = x.first.length <= y.first.length ? [x.first, y.first] : [y.first, x.first];
  return s.length >= 3 && l.startsWith(s);
}

/** True when any row in `rows` names the same person as `name`. */
export function hasSameOfficial(rows: Array<{ full_name: string }> | null | undefined, name: string): boolean {
  return (rows ?? []).some((r) => sameOfficial(r.full_name, name));
}
