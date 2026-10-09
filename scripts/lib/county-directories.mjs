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

/**
 * South Carolina Association of Counties — one directory page per county
 * (Name | Position | Phone | Address), linked from county-directory-pages.
 * Each page mixes the council with ~35 staff roles, so only council seats are
 * kept: chair / vice chair (-man or -woman), "County Council", "Council
 * Member", and "Supervisor/Chairman" where a county uses the council-supervisor
 * form. Addresses (often homes) are never stored.
 */
export const SC_COUNCIL_RE = /^(county council|council (member|chair(man|woman|person)?|vice[- ]chair(man|woman|person)?)|supervisor\/chair(man|woman|person)?|county supervisor)$/i;

export function scacCountyLinks(indexHtml, base = "https://www.sccounties.org") {
  return [...new Set([...String(indexHtml ?? "").matchAll(/href="(\/county\/[a-z-]+\/directory)"/g)].map((m) => base + m[1]))];
}

export function parseScacCountyPage(html) {
  const s = String(html ?? "");
  const county = textOf((s.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]);
  if (!/ County$/.test(county)) return [];
  const body = (s.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/) || [])[1] ?? "";
  const out = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const [full_name, title, phone] = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => textOf(m[1]));
    if (!full_name || full_name.split(" ").length < 2 || !SC_COUNCIL_RE.test(title ?? "")) continue;
    out.push({ county, full_name, title, phone: phone || null, email: null, role: "county_commissioner" });
  }
  return out;
}

/**
 * New Mexico Counties — member directory filtered to commissioners (a
 * WordPress search-and-filter list, ~16 pages). One block per person: name,
 * "Commissioner - District 4[ - Chair]" (Los Alamos: "Councilor"), phone,
 * email, county.
 */
const NMC_DIRECTORY = "https://www.nmcounties.org/member-directory/?_sft_directory_position=commissioner";
export function nmcPageLinks(firstPageHtml) {
  const pages = Number((String(firstPageHtml ?? "").match(/Page \d+ of (\d+)/) || [])[1] ?? 1);
  return Array.from({ length: Math.min(Math.max(pages, 1), 60) }, (_, i) => (i === 0 ? NMC_DIRECTORY : `${NMC_DIRECTORY}&sf_paged=${i + 1}`));
}
export function parseNmcDirectory(html) {
  const out = [];
  const s = String(html ?? "").replace(/<!--[\s\S]*?-->/g, " ");
  for (const b of s.split(/<div class="directory-block">/).slice(1)) {
    const full_name = textOf((b.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1]).replace(/[“”]/g, '"');
    const position = textOf((b.match(/<p>\s*([^<]+?)\s*<br/) || [])[1]);
    const county = textOf((b.match(/<span class="type">([^<]*County)<\/span>/) || [])[1]);
    if (!/ County$/.test(county) || full_name.split(" ").length < 2 || !/commissioner|councilor/i.test(position)) continue;
    const district = (position.match(/District\s+([\w-]+)/i) || [])[1] ?? null;
    const title = /chair/i.test(position) ? "Commission Chair" : /councilor/i.test(position) ? "County Councilor" : "County Commissioner";
    out.push({
      county, full_name, title, district,
      phone: (b.match(/href="tel:([^"]+)"/) || [])[1]?.trim() || null,
      email: (b.match(/href="mailto:([^"]+)"/) || [])[1]?.trim() || null,
      role: "county_commissioner",
    });
  }
  return out;
}

const WEBMAIL = /@(gmail|yahoo|hotmail|outlook|live|aol|icloud|me|msn|comcast|att|sbcglobal|bellsouth|verizon|charter|cox|earthlink|protonmail|ymail)\./i;
/**
 * A free-webmail address that shares nothing with the person's name is most
 * likely someone else's (2026-10-09: an NM directory listed a commissioner with
 * another person's gmail). Sending a member's message there is worse than
 * having no address, so it becomes null. Office and district mailboxes pass.
 */
export function emailOrNull(email, fullName) {
  const e = String(email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return null;
  if (!WEBMAIL.test(e)) return e;
  const local = e.split("@")[0].toLowerCase().replace(/[^a-z]/g, "");
  const parts = decodeEntities(fullName).toLowerCase().replace(/"[^"]*"/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((p) => p.length >= 3);
  return parts.some((p) => local.includes(p.slice(0, 4))) ? e : null;
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
  SC: {
    url: "https://www.sccounties.org/county-information/county-directory-pages",
    // One page per county, discovered from the index page.
    linksFrom: scacCountyLinks,
    label: "South Carolina Association of Counties county directory",
    counties: 46,
    parse: parseScacCountyPage,
  },
  NM: {
    url: "https://www.nmcounties.org/member-directory/?_sft_directory_position=commissioner",
    linksFrom: nmcPageLinks,
    label: "New Mexico Counties member directory (commissioners)",
    counties: 33,
    parse: parseNmcDirectory,
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
