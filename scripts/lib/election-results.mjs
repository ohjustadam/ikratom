/**
 * election-results.mjs — read who won each seat from a Wikipedia election
 * article. The pure core of scripts/ingest-election-results.mjs (officials
 * turnover, part c); tested in tests/election-results.test.ts against the
 * shapes the 2024 pages use.
 *
 * Wikipedia marks a winner three ways, and a page may use any of them:
 *   1. an "Elected senator / Elected representative / Winner" column;
 *   2. a green tick ("Y", or ✓) before a name in the Candidates column
 *      — the U.S. House and Senate pages;
 *   3. a Status column saying "Incumbent reelected", plus vote shares
 *      ("▌ Name - 86.3%") when someone new won.
 * Before results are in, none of the three is present, so a pre-election
 * page yields no winners — "running for reelection" never reads as elected.
 *
 * A winner read here is ONE source. The ingester confirms it on a second day
 * before it changes a seat's status, and the swap (part d) needs a second,
 * independent roster source before anyone goes inactive.
 */
import { createRequire } from "node:module";
import { normalizeDistrict } from "./term-calendar.mjs";
import { STATE_NAMES } from "./us-states.mjs";

const require = createRequire(import.meta.url);
const clean = (s) => String(s ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
const ABBR_BY_NAME = Object.fromEntries(Object.entries(STATE_NAMES).map(([a, n]) => [n.toLowerCase(), a]));

/**
 * A table as a rectangular grid of cell texts, rowspan and colspan expanded, so
 * a district cell spanning two rows (a two-member district) labels both.
 * @returns {{text:string, th:boolean}[][]}
 */
export function tableGrid(table) {
  const grid = [];
  const carry = [];
  for (const tr of table.querySelectorAll("tr")) {
    const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");
    const row = [];
    let col = 0, i = 0;
    while (i < cells.length || carry[col]?.rows > 0) {
      if (carry[col]?.rows > 0) { row[col] = carry[col].cell; carry[col].rows--; col++; continue; }
      const c = cells[i++];
      const cs = Math.min(Number(c.getAttribute("colspan")) || 1, 50);
      const rs = Math.min(Number(c.getAttribute("rowspan")) || 1, 500);
      const cell = { text: clean(c.textContent), th: c.tagName === "TH" };
      for (let k = 0; k < cs; k++, col++) { row[col] = cell; if (rs > 1) carry[col] = { cell, rows: rs - 1 }; }
    }
    grid.push(row);
  }
  return grid;
}

/** Column roles from the header rows (the leading all-<th> rows). */
export function columnRoles(grid) {
  let h = 0;
  while (h < grid.length && grid[h].length && grid[h].every((c) => c?.th)) h++;
  const width = Math.max(0, ...grid.map((r) => r.length));
  const labels = [];
  for (let c = 0; c < width; c++) {
    labels.push([...new Set(grid.slice(0, Math.max(h, 1)).map((r) => r[c]?.text ?? "").filter(Boolean))].join(" "));
  }
  const find = (re, not) => labels.findIndex((l) => re.test(l) && !(not && not.test(l)));
  return {
    headerRows: Math.max(h, 1),
    district: find(/district|\bdist\.|^no\.?$|location|^state$/i),
    // Minnesota splits "1" and "A" across a two-column District header.
    districtSub: labels.findIndex((l, i) => i > 0 && l && l === labels[i - 1] && /district/i.test(l)),
    incumbent: find(/incumbent|member|senator|representative/i, /party|first|status|elected|history|candidate/i),
    elected: find(/elected\s*(senator|representative|member|delegate|assembly)|winner|^elected$/i, /first/i),
    status: find(/status|result|outcome/i, /last result/i),
    candidates: find(/candidate/i),
  };
}

const NAME_OK = (s) => /[a-z]{2,}.*\s+.*[a-z]{2,}/i.test(s) && !/^(none|vacant|tbd|tba|new (seat|district))\b/i.test(s);
const tidy = (s) => clean(s).replace(/[†‡*]/g, "").replace(/^(?:Sen|Rep|Del|Hon)\.\s+/, "")
  .replace(/\s*\((?:incumbent|retiring|[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\)\s*$/gi, "")
  .replace(/(?:\s+|(?<=[a-z]))(Redistricted|Retiring|Elected|Eliminated)\b.*$/, "").trim();
const surname = (s) => tidy(s).normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[\s-]+/).filter((t) => t.length > 1).pop() ?? "";

/**
 * The winner(s) a row names, or [] when it names none yet.
 * @param {{text:string}[]} row
 * @param {ReturnType<typeof columnRoles>} cols
 */
export function winnersFromRow(row, cols) {
  const at = (i) => (i >= 0 ? row[i]?.text ?? "" : "");
  const elected = tidy(at(cols.elected));
  if (cols.elected >= 0 && NAME_OK(elected) && elected !== tidy(at(cols.district))) return [elected];

  const cand = cols.candidates >= 0 ? at(cols.candidates) : row.map((c) => c?.text ?? "").join(" ▌ ");
  const ticked = [...cand.matchAll(/(?:✓|(?:^|[\s▌])Y)\s+([^()▌%✓]+?)\s*\(/g)].map((m) => tidy(m[1])).filter(NAME_OK);
  if (ticked.length) return [...new Set(ticked)];

  const status = at(cols.status);
  if (/\bincumbent\s+re-?elected\b/i.test(status)) {
    const inc = tidy(at(cols.incumbent));
    // A stale status beside a candidate list that eliminates the incumbent
    // (2026 OK Senate D20, seen 2026-10-23) is a contradiction: no winner.
    const last = surname(inc);
    if (last && new RegExp(`${last}[^▌]*\\b(eliminated|lost|withdrew|disqualified)`, "i").test(cand)) return [];
    return NAME_OK(inc) ? [inc] : [];
  }
  if (/\b(new member elected|elected|gain|hold)\b/i.test(status) && !/running|retiring|seeking/i.test(status)) {
    const shares = [...cand.matchAll(/▌?\s*([^▌]+?)\s+-\s+([\d.]+)%/g)].map((m) => ({ name: tidy(m[1]), pct: Number(m[2]) }));
    const top = shares.filter((s) => NAME_OK(s.name)).sort((a, b) => b.pct - a.pct)[0];
    if (top) return [top.name];
  }
  return [];
}

/**
 * District key for a row: "17", "A" for a state chamber; "OK-5" / "AK-0"
 * (at-large) for the U.S. House national page; "OH" for the Senate page.
 */
export function rowKey(text, mode) {
  const t = clean(text);
  if (mode === "district" && /^\d{1,3}[A-Z]$/.test(t)) return t.toLowerCase(); // Minnesota's "1A"
  // Named districts ("Hillsborough 40", "Second Essex", Massachusetts' "10th Bristol") are matched as text, lowercased.
  if (mode === "district") return normalizeDistrict(t) ?? (/^(?:\d{1,2}(?:st|nd|rd|th) )?[A-Za-z][A-Za-z ,.'&-]{2,58}\d{0,3}$/.test(t) && !/^(total|district)/i.test(t) ? t.toLowerCase() : null);
  const m = /^([A-Za-z .]+?)\s+(at-large|\d{1,2})\b/i.exec(t.replace(/ /g, " "));
  if (mode === "state-district") {
    if (!m) return null;
    const abbr = ABBR_BY_NAME[m[1].toLowerCase()];
    return abbr ? `${abbr}-${/at-large/i.test(m[2]) ? "0" : String(Number(m[2]))}` : null;
  }
  const abbr = ABBR_BY_NAME[t.replace(/\s*\(.*$/, "").toLowerCase()];
  return abbr ?? null;
}

/**
 * Every result row on the page, keyed. A key may map to several rows (a
 * two-member district, or a state with a regular and a special Senate race).
 * @param {string} html  the parsed article HTML (action=parse&prop=text)
 * @param {"district"|"state-district"|"state"} mode
 * @returns {Map<string, {incumbent:string, winners:string[]}[]>}
 */
export function parseWikiResults(html, mode = "district") {
  const { parseHTML } = require("linkedom");
  // A <br> joins its neighbours in textContent: "Elected<br>representative"
  // would read "Electedrepresentative" and the column would go unrecognised
  // (the Alaska, Hawaii and Florida Senate 2026 pages).
  const { document } = parseHTML(`<html><body>${String(html).replace(/<br\s*\/?>/gi, " ")}</body></html>`);
  const out = new Map();
  for (const table of document.querySelectorAll("table.wikitable")) {
    const grid = tableGrid(table);
    const cols = columnRoles(grid);
    if (cols.district < 0 || (cols.elected < 0 && cols.candidates < 0 && cols.status < 0)) continue;
    for (const row of grid.slice(cols.headerRows)) {
      const sub = cols.districtSub >= 0 ? row[cols.districtSub]?.text ?? "" : "";
      const key = rowKey(`${row[cols.district]?.text ?? ""}${/^[A-Z]$/.test(sub) ? sub : ""}`, mode);
      if (!key) continue;
      const entry = { incumbent: tidy(row[cols.incumbent]?.text ?? ""), winners: winnersFromRow(row, cols) };
      const list = out.get(key) ?? [];
      if (!list.some((e) => e.incumbent === entry.incumbent && e.winners.join() === entry.winners.join())) list.push(entry);
      out.set(key, list);
    }
  }
  if (mode === "district") {
    for (const [key, rows] of electionBoxes(document)) {
      if (!(out.get(key) ?? []).some((r) => r.winners.length)) out.set(key, rows);
    }
  }
  return out;
}

/**
 * Pages with no district table (Indiana, Illinois, South Dakota) give each
 * district its own heading and a vote box. The winner is the bold row, and a
 * "hold" or "gain" line says the race is closed: a box without one is still
 * being filled in. Primary boxes are skipped, so a primary winner never reads
 * as elected.
 * @returns {Map<string, {incumbent:string, incumbents:string[], winners:string[], box:true}[]>}
 */
function electionBoxes(document) {
  const out = new Map();
  let district = null, section = "";
  for (const el of document.querySelectorAll("h2, h3, h4, h5, table")) {
    if (el.tagName !== "TABLE") {
      const text = clean(el.textContent);
      const m = /^(?:District\s+(\d{1,3}[A-Z]?)|(\d{1,3})(?:st|nd|rd|th)\s+district)\b/i.exec(text);
      if (m) { district = (m[1] ?? m[2]).replace(/^0+/, "").toLowerCase(); section = ""; }
      else if (el.tagName === "H2") { district = null; section = ""; }
      else section = text;
      continue;
    }
    if (!district) continue;
    const all = clean(el.textContent);
    const head = [...el.querySelectorAll("tr")].map((tr) => [...tr.children]).find((c) => c.some((x) => /^candidate$/i.test(clean(x.textContent))));
    if (!head || !/\b(hold|gain)\b/i.test(all)) continue;
    const fromEnd = head.length - head.findIndex((x) => /^candidate$/i.test(clean(x.textContent))); // columns after it vary (Votes, %, ±%)
    if (/primary|runoff/i.test(`${clean(el.querySelector("caption")?.textContent)} ${section}`)) continue;
    const winners = [], incumbents = [];
    for (const tr of el.querySelectorAll("tr")) {
      const cells = [...tr.children];
      if (cells.length < 4) continue;
      const cell = cells[cells.length - fromEnd];
      const name = tidy(cell.textContent);
      if (!NAME_OK(name) || /^(total|candidate)/i.test(name)) continue;
      if (/\(incumbent\)/i.test(cell.textContent)) incumbents.push(name);
      if (cell.querySelector("b")) winners.push(name);
    }
    if (winners.length) out.set(district, [{ incumbent: incumbents[0] ?? "", incumbents, winners, box: true }]);
  }
  return out;
}

const FL_RACE = { STR: "state_house", STS: "state_senate", USR: "us_house", USS: "us_senate" };

/**
 * Florida's own election-night file, one row per candidate per county. It is
 * read only when every county has finished, and a margin under half a point
 * is left alone because state law sends that to a recount. Candidates with no
 * opponent are not on the ballot, so those seats stay with Wikipedia.
 * @param {string} text  the tab-separated results file
 * @returns {Map<string, {incumbent:string, winners:string[], box:true}[]>}  keyed "state_house-62", "us_senate-"
 */
export function parseFloridaResults(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines[0].split("\t");
  const col = (name) => head.indexOf(name);
  const races = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split("\t");
    const office = FL_RACE[c[col("RaceCode")]];
    if (!office) continue;
    const district = /District\s+(\d+)/.exec(c[col("RaceName")])?.[1] ?? "";
    const key = `${office}-${district}`;
    const race = races.get(key) ?? { done: true, votes: new Map() };
    if (Number(c[col("PrecinctsReporting")]) < Number(c[col("Precincts")])) race.done = false;
    const name = clean(`${c[col("CanNameFirst")]} ${c[col("CanNameLast")]}`);
    race.votes.set(name, (race.votes.get(name) ?? 0) + Number(c[col("CanVotes")]));
    races.set(key, race);
  }
  const out = new Map();
  for (const [key, race] of races) {
    const ranked = [...race.votes].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((n, [, v]) => n + v, 0);
    const clear = ranked.length > 1 && total > 0 && (ranked[0][1] - ranked[1][1]) / total >= 0.005;
    out.set(key, [{ incumbent: "", winners: race.done && clear ? [ranked[0][0]] : [], box: true }]);
  }
  return out;
}

/**
 * The result in a single-race article's infobox ("2026 Oklahoma gubernatorial
 * election"): "<Office> before election" names the incumbent and "Elected
 * <Office>" the winner. Before results are in, the box says "Incumbent
 * <Office>" and has no "Elected" line, so it yields no winner. The national
 * statewide-office pages carry only a surname and a share ("Stitt 55.4% R"),
 * which is why statewide seats read this instead.
 * @param {string} html  the parsed article HTML (action=parse&prop=text)
 * @returns {{incumbent:string, winners:string[]} | null}
 */
export function parseInfoboxResult(html) {
  const { parseHTML } = require("linkedom");
  const { document } = parseHTML(`<html><body>${String(html).replace(/<br\s*\/?>/gi, " ")}</body></html>`);
  const box = document.querySelector("table.infobox");
  if (!box) return null;
  // The first link after the bold label, before the next label: the name is
  // linked, the party after it is a single word and fails NAME_OK.
  const nameAfter = (label) => {
    const b = [...box.querySelectorAll("b")].find((x) => label.test(clean(x.textContent)));
    let a = null;
    for (let el = b?.nextElementSibling; el && !a; el = el.nextElementSibling) {
      if (el.tagName === "B") break;
      a = el.tagName === "A" ? el : el.querySelector("a");
    }
    const name = tidy(a?.textContent ?? "");
    return NAME_OK(name) ? name : "";
  };
  const incumbent = nameAfter(/\bbefore election$/i) || nameAfter(/^incumbent\b/i);
  const winner = nameAfter(/^elected\b/i);
  return incumbent ? { incumbent, winners: winner ? [winner] : [] } : null;
}
