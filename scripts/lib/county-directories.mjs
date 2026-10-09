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

/**
 * Kentucky Association of Counties — county officials directory. The page
 * server-renders every official it is asked for (?title=...), one entry per
 * person: county, name, title, a mailing address (often a HOME address — never
 * stored) and a phone. Kentucky's governing body is the fiscal court: the
 * County Judge/Executive presides over the magistrates or commissioners.
 */
export function parseKacoDirectory(html) {
  const out = [];
  for (const e of String(html ?? "").split(/<div class="pt-2 pb-4 /).slice(1)) {
    const county = textOf((e.match(/title-county-name-all[^>]*>([^<]+)</) || [])[1]);
    const full_name = textOf((e.match(/official-name">\s*<h3>([\s\S]*?)<\/h3>/) || [])[1]);
    const title = textOf((e.match(/official-title">([\s\S]*?)<\/div>/) || [])[1]);
    const phone = (e.match(/href="tel:([^"]+)"/) || [])[1]?.trim() || null;
    const email = (e.match(/href="mailto:([^"]+)"/) || [])[1]?.trim() || null;
    if (!/ County$/.test(county) || full_name.split(" ").length < 2) continue;
    const role = /judge\s*\/\s*exec/i.test(title) ? "county_executive" : "county_commissioner";
    out.push({ county, full_name, title, phone, email, role });
  }
  return out;
}

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const t = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((x) => x !== "")) rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/**
 * Tennessee — CTAS (UT Institute for Public Service) publishes official CSV
 * exports of every county's commissioners and of every county mayor /
 * executive. Columns: County, Name, Title, Address, City, Zip Code, Fax,
 * [Main Phone], Email Address. Addresses are never stored. Davidson's
 * governing body is the Metro Council, listed as "Metro Councilmember".
 */
export function parseCtasCsv(csv) {
  return parseCsv(csv)
    .filter((r) => r.County && r.Name && r.Name.split(/\s+/).length >= 2)
    .map((r) => ({
      county: `${r.County.replace(/\s+County$/i, "")} County`,
      full_name: r.Name.replace(/\s+/g, " "),
      title: r.Title || "County Commissioner",
      phone: r["Main Phone"] || null,
      email: r["Email Address"] || null,
      role: /mayor|executive/i.test(r.Title ?? "") ? "county_executive" : "county_commissioner",
    }));
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
  KY: {
    url: "https://kaco.org/county-information/county-officials-directory/",
    urls: [
      "https://kaco.org/county-information/county-officials-directory/?coId=All&title=County+Judge%2FExecutive",
      "https://kaco.org/county-information/county-officials-directory/?coId=All&title=County+Magistrate%2FCommissioner",
    ],
    label: "Kentucky Association of Counties county officials directory",
    counties: 120,
    parse: parseKacoDirectory,
  },
  TN: {
    url: "https://www.ctas.tennessee.edu/county-commissioners",
    urls: [
      "https://www.ctas.tennessee.edu/csv-county-commissioners",
      "https://www.ctas.tennessee.edu/csv-county-executives-and-mayors",
    ],
    label: "CTAS (University of Tennessee) county officials directory",
    counties: 95,
    parse: parseCtasCsv,
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
