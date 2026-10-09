/**
 * Statewide county-board directories — deterministic parsers, no AI.
 *
 * WHY (2026-10-09): only ~80 of 3,143 counties had officials on file, and the
 * per-county resolver (search → fetch → model extraction) is slow and has
 * filed election officials as commissioners. Some states publish ONE
 * authoritative page listing every county's governing board. Parsing that
 * page's markup is exact, needs no key and no model, and covers a whole state
 * in one fetch. Each adapter returns
 *   [{ county: "Kidder County", full_name, title, phone, email }]
 * and is pinned by tests/county-directories.test.ts against a real fixture.
 *
 * Add a state only when its directory is (1) published by the state or its
 * association of counties, (2) public and keyless, (3) covers every county,
 * (4) parseable from markup alone. If a page changes shape the parser returns
 * fewer rows, and the seeder refuses to write a state whose parse came back
 * short (see minCounties).
 */
import { isNonGoverningCountyTitle } from "./officials-extract.mjs";

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#039": "'", "#160": " " };
export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k in ENTITIES) return ENTITIES[k];
      if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith("#")) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return m;
    });
}
const textOf = (html) => decodeEntities(String(html ?? "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * North Dakota Association of Counties — the commissioners directory behind
 * ndcca.org/commissioners (it is that page's iframe). One
 * `cdepart byPosition_county` block per county, one `eblock` per person with
 * data-position, a nickname span (class "hide" when empty), office/cell/home
 * phones and an email. Home phones are deliberately NOT used.
 */
export function parseNdacoDirectory(html) {
  const out = [];
  const blocks = String(html ?? "").split(/<div class="cdepart byPosition_county">/).slice(1);
  for (const block of blocks) {
    const county = textOf((block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1]);
    if (!/\b(County)$/.test(county)) continue;
    for (const e of block.split(/<div class="eblock"/).slice(1)) {
      const title = decodeEntities((e.match(/data-position="([^"]*)"/) || [])[1] ?? "").trim();
      const strong = (e.match(/<div class="cpname"><strong>([\s\S]*?)<\/strong>/) || [])[1] ?? "";
      // Nickname: <span class="hideNick">Nick </span>; empty ones are class="hide".
      const nick = textOf((strong.match(/<span class="hide([^"]+)">([\s\S]*?)<\/span>/) || [])[2]);
      const plain = textOf(strong.replace(/<span class="hide[^"]*">[\s\S]*?<\/span>/, " "));
      const parts = plain.split(" ");
      const full_name = nick && parts.length >= 2
        ? `${parts[0]} "${nick}" ${parts.slice(1).join(" ")}`
        : plain;
      const office = (e.match(/officePhone[^>]*><a href="tel:([^"]*)"/) || [])[1]?.trim();
      const cell = (e.match(/data-cellphone="([^"]*)"/) || [])[1]?.trim();
      const email = (e.match(/href="mailto:([^"]+)"/) || [])[1]?.trim();
      if (!full_name || full_name.split(" ").length < 2) continue;
      out.push({ county, full_name, title: title || "County Commissioner", phone: office || cell || null, email: email || null });
    }
  }
  return out;
}

/** The registry the seeder walks. counties = how many a full parse must name. */
export const COUNTY_DIRECTORIES = {
  ND: {
    url: "https://www.ndaco.org/ndcca-commissioners/",
    label: "North Dakota Association of Counties commissioners directory",
    counties: 53,
    party: "Nonpartisan", // ND county offices are elected on a nonpartisan ballot
    parse: parseNdacoDirectory,
  },
};

/** Loose identity for "is this person already on file": same last name + same first initial. */
export function nameKey(fullName) {
  const n = decodeEntities(fullName).toLowerCase()
    .replace(/"[^"]*"|\([^)]*\)/g, " ")                 // nicknames
    .replace(/\b(jr|sr|ii|iii|iv|dr|mr|mrs|ms)\b\.?/g, " ")
    .replace(/[^a-z\s'-]/g, " ").replace(/\s+/g, " ").trim();
  const parts = n.split(" ").filter(Boolean);
  if (parts.length < 2) return n;
  return `${parts[0][0]}|${parts[parts.length - 1]}`;
}

/** Keep only governing-board people (same rule the resolver uses). */
export function boardOnly(people) {
  return people.filter((p) => !isNonGoverningCountyTitle(p.title));
}
