/**
 * term-calendar.mjs — the pure core of the officials-turnover engine: when does
 * each office turn over, and which seats are on a given ballot.
 *
 * Nothing here is kratom-specific and nothing touches the database, so every
 * rule is unit-tested (tests/term-calendar.test.ts) and the engine can serve
 * any cause. Callers: scripts/sync-seat-watch.mjs.
 *
 * THE TERM-START RULE IS PROVEN, NOT TYPED IN. A state's constitution says when
 * newly elected legislators take office ("the fifteenth day after the general
 * election", "the second Monday in January", "December 1"). Rather than keep 99
 * of those by hand, deriveTermStart() tries every rule shape below against the
 * dates openstates/people actually recorded for the freshmen of the two most
 * recent cycles, and accepts a date for the coming cycle only when every rule
 * that fits BOTH observed cycles predicts the same day. A chamber that fits no
 * rule (Colorado moved its convening day between 2023 and 2025) gets no date:
 * a wrong handover date is worse than none.
 *
 * WHICH SEATS ARE UP comes from NCSL's per-chamber counts plus, for staggered
 * chambers, the district list on the Wikipedia page for that chamber's
 * election. The list is accepted only when its seat count equals NCSL's — two
 * independent sources agreeing — and the caller checks each listed district's
 * incumbent against our roster as well.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const DAY = 86_400_000;

/** ISO day → UTC Date. */
function d(iso) { return new Date(`${iso}T00:00:00Z`); }
/** UTC Date → ISO day. */
function iso(date) { return date.toISOString().slice(0, 10); }

export function addDays(day, n) { return iso(new Date(d(day).getTime() + n * DAY)); }

/** US general election: the Tuesday after the first Monday in November. */
export function electionDay(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstMon = 1 + ((8 - nov1.getUTCDay()) % 7);
  return iso(new Date(Date.UTC(year, 10, firstMon + 1)));
}

/** The nth (1-based) weekday (0=Sun) of a month (1-12). */
function nthWeekday(year, month, n, weekday) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return iso(new Date(Date.UTC(year, month - 1, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7)));
}

/** November/December belong to the election year; January–March to the year after. */
function yearFor(cycle, month) { return month >= 11 ? cycle : cycle + 1; }

/**
 * Every rule shape tried, simplest first. Rule strings are stored in
 * term_calendar.term_start_rule, so keep them stable:
 *   election+Nd        N days after election day (0 = takes office on election day)
 *   fixed:MM-DD        a calendar day
 *   nth:M:N:W          the Nth weekday W (0=Sun) of month M
 *   firstmon+K:M       K days after the first Monday of month M ("the Wednesday after the first Monday")
 */
export const RULES = (() => {
  const out = [];
  for (let n = 0; n <= 45; n++) out.push(`election+${n}d`);
  for (const md of ["12-01", "12-15", "01-01", "01-02", "01-03"]) out.push(`fixed:${md}`);
  for (const m of [11, 12, 1]) for (let n = 1; n <= 4; n++) for (let w = 0; w <= 6; w++) out.push(`nth:${m}:${n}:${w}`);
  for (const m of [12, 1]) for (let k = 1; k <= 6; k++) out.push(`firstmon+${k}:${m}`);
  return out;
})();

/** The day a rule names for the cycle whose general election is in `cycle`. */
export function applyRule(rule, cycle) {
  let m;
  if ((m = /^election\+(\d+)d$/.exec(rule))) return addDays(electionDay(cycle), Number(m[1]));
  if ((m = /^fixed:(\d\d)-(\d\d)$/.exec(rule))) return `${yearFor(cycle, Number(m[1]))}-${m[1]}-${m[2]}`;
  if ((m = /^nth:(\d+):(\d):(\d)$/.exec(rule))) return nthWeekday(yearFor(cycle, Number(m[1])), Number(m[1]), Number(m[2]), Number(m[3]));
  if ((m = /^firstmon\+(\d):(\d+)$/.exec(rule))) {
    const month = Number(m[2]);
    return addDays(nthWeekday(yearFor(cycle, month), month, 1, 1), Number(m[1]));
  }
  throw new Error(`unknown term-start rule ${rule}`);
}

/**
 * The modal start date of each cycle's freshmen in one chamber.
 * `starts` is every role start date recorded for the chamber (a career list is
 * fine: re-elected members keep their first start, so only newcomers land in a
 * cycle's window). A cycle counts only with >= MIN_N starts and a modal share
 * of at least half, so one appointee sworn in mid-January cannot set a rule.
 *
 * @param {string[]} starts ISO days
 * @param {number[]} cycles election years to look at
 * @returns {{cycle:number, date:string, n:number, of:number}[]}
 */
export const MIN_N = 3;
export function observedStarts(starts, cycles, minN = MIN_N) {
  const out = [];
  for (const cycle of cycles) {
    const from = addDays(electionDay(cycle), -1);
    const to = `${cycle + 1}-02-28`;
    const counts = new Map();
    let of = 0;
    for (const s of starts) {
      if (!s || s < from || s > to) continue;
      of++;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const [date, n] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [];
    if (date && n >= minN && n * 2 >= of) out.push({ cycle, date, n, of });
  }
  return out;
}

const evidenceOf = (obs) => obs.map((o) => `${o.cycle}: ${o.n}/${o.of} took office ${o.date}`).join("; ");

/**
 * Derive the handover day for `target` from observed cycles.
 * Starts from the two most recent observations; every rule that reproduces
 * them must agree on the target cycle's date. When they disagree (California's
 * "first Monday in December" and "27 days after the election" both fit 2022
 * and 2024), the next older cycle is added until one answer remains. A rule
 * that stops fitting as older cycles join is never chosen, so a state that
 * changed its law (Colorado, 2023 vs 2025) simply gets no date.
 *
 * @returns {{date:string, rule:string, evidence:string} | {date:null, reason:string}}
 */
export function deriveTermStart(observations, target) {
  const sorted = [...observations].sort((a, b) => b.cycle - a.cycle);
  if (sorted.length < 2) return { date: null, reason: `only ${sorted.length} observed cycle(s)` };
  let reason = "";
  for (let k = 2; k <= sorted.length; k++) {
    const obs = sorted.slice(0, k);
    const fits = RULES.filter((r) => obs.every((o) => applyRule(r, o.cycle) === o.date));
    if (fits.length === 0) return { date: null, reason: reason || `no rule fits ${obs.map((o) => o.date).join(" and ")}` };
    const dates = new Set(fits.map((r) => applyRule(r, target)));
    if (dates.size === 1) return { date: [...dates][0], rule: fits[0], evidence: evidenceOf(obs) };
    reason = `rules disagree for ${target}: ${[...dates].join(", ")}`;
  }
  return { date: null, reason };
}

/**
 * Both chambers of one state, with a fallback for a chamber too small to judge
 * alone. A partial-term senate can seat only two freshmen in a cycle (Texas,
 * 2024), below MIN_N. Such a chamber borrows its sibling's rule — one
 * constitution usually seats both houses — but only when every start it DID
 * record (one or more freshmen) lands exactly on that rule. A chamber whose
 * own evidence conflicts never borrows.
 *
 * @param {Record<string,string[]>} startsByChamber e.g. { upper: [...], lower: [...] }
 * @param {number[]} cycles observed election years
 * @param {number} target the cycle to predict
 */
export function deriveStateTermStarts(startsByChamber, cycles, target) {
  const own = {};
  for (const [chamber, starts] of Object.entries(startsByChamber)) {
    own[chamber] = deriveTermStart(observedStarts(starts, cycles), target);
  }
  const out = {};
  for (const [chamber, starts] of Object.entries(startsByChamber)) {
    const mine = own[chamber];
    if (mine.date || !/^only \d/.test(mine.reason)) { out[chamber] = mine; continue; }
    const sibling = Object.entries(own).find(([c, r]) => c !== chamber && r.date);
    const weak = observedStarts(starts, cycles, 1);
    if (sibling && weak.length >= 1 && weak.every((o) => applyRule(sibling[1].rule, o.cycle) === o.date)) {
      out[chamber] = {
        date: applyRule(sibling[1].rule, target),
        rule: sibling[1].rule,
        evidence: `rule of the ${sibling[0]} chamber (${sibling[1].evidence}); this chamber agrees: ${evidenceOf(weak)}`,
      };
    } else out[chamber] = mine;
  }
  return out;
}

// ── NCSL "2026 legislative races by state and chamber" ─────────────────────

export const NCSL_RACES_URL = "https://www.ncsl.org/elections-and-campaigns/2026-legislative-races-by-state-and-chamber";

function num(s) { const n = Number(String(s).replace(/[^\d]/g, "")); return String(s).trim() && Number.isFinite(n) && /\d/.test(s) ? n : null; }
function years(s) { const m = /(\d)\s*year/i.exec(String(s)); return m ? Number(m[1]) : null; }

/**
 * Parse NCSL's chamber table.
 * @returns {Map<string, {upper:{termYears,total,up}|null, lower:{termYears,total,up}|null}>} keyed by state NAME
 */
export function parseNcslRaces(html) {
  const { parseHTML } = require("linkedom");
  const { document } = parseHTML(html);
  const out = new Map();
  for (const table of document.querySelectorAll("table")) {
    const rows = [...table.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => c.textContent.trim().replace(/\s+/g, " ")));
    const head = (rows[0] ?? []).join("|");
    if (!/Senate Seats up/i.test(head) || !/House Seats up/i.test(head)) continue;
    for (const r of rows.slice(1)) {
      if (r.length < 7 || /^totals?$/i.test(r[0])) continue;
      const upper = num(r[2]) != null ? { termYears: years(r[1]), total: num(r[2]), up: num(r[3]) ?? 0 } : null;
      const lower = num(r[5]) != null ? { termYears: years(r[4]), total: num(r[5]), up: num(r[6]) ?? 0 } : null;
      out.set(r[0], { upper, lower });
    }
  }
  return out;
}

// ── Wikipedia "<year> <State> <Chamber> election" district tables ──────────

/**
 * Normalize a district label to our legislators.district form:
 * "District 17", "17th", "17[a]" → "17"; "A" stays "A" (Alaska's senate).
 * Returns null for anything that is not a single district label.
 */
export function normalizeDistrict(text) {
  const t = String(text ?? "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
  let m;
  if ((m = /^(?:(?:state\s+)?(?:senate|house|assembly)\s+)?(?:district\s+)?0*(\d{1,3})(?:st|nd|rd|th)?(?:\s+district)?$/i.exec(t))) return String(Number(m[1]));
  if ((m = /^(?:district\s+)?([A-T])$/.exec(t))) return m[1];
  return null;
}

const SKIP_SECTION = /predict|partisanship|competitive|primar|detailed|polling|fundrais|retire|opinion|endorse|result by|vote share/i;

function sectionOf(table) {
  for (let el = table; el; el = el.parentElement) {
    for (let p = el.previousElementSibling; p; p = p.previousElementSibling) {
      if (/^H[2-4]$/.test(p.tagName)) return p.textContent.trim();
      if (p.classList?.contains("mw-heading")) return p.textContent.replace(/\[edit\]/g, "").trim();
    }
  }
  return "";
}

/**
 * The seats on a chamber's ballot, from the page's district summary tables.
 * A table qualifies when its header names both a district and an incumbent;
 * the regular list is the qualifying table with the most districts, and a
 * table under a "Special election(s)" heading is the special list.
 *
 * @returns {{regular: Map<string,string>, special: Map<string,string>}} district → incumbent as listed
 */
export function parseWikiSeatTables(html) {
  const { parseHTML } = require("linkedom");
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  let regular = new Map();
  const special = new Map();
  for (const table of document.querySelectorAll("table.wikitable")) {
    const trs = [...table.querySelectorAll("tr")];
    const head = trs.slice(0, 2).map((tr) => [...tr.querySelectorAll("th")].map((c) => c.textContent).join("|")).join("|");
    if (!/district/i.test(head) || !/incumbent|member/i.test(head)) continue;
    const section = sectionOf(table);
    const isSpecial = /special/i.test(section);
    if (!isSpecial && SKIP_SECTION.test(section)) continue;
    const seats = new Map();
    for (const tr of trs) {
      const cells = [...tr.children].filter((c) => c.tagName === "TD" || c.tagName === "TH");
      if (cells.length < 2 || cells[0].tagName !== "TD") continue;
      const district = normalizeDistrict(cells[0].textContent);
      if (!district || seats.has(district)) continue;
      const name = cells.slice(1).map((c) => c.textContent.replace(/\[[^\]]*\]/g, "").trim()).find((s) => /[a-z]{2,}\s+[a-z]/i.test(s) && !/^(rep|dem|republican|democratic|independent|vacant)/i.test(s));
      seats.set(district, name ?? "");
    }
    if (isSpecial) for (const [k, v] of seats) special.set(k, v);
    else if (seats.size > regular.size) regular = seats;
  }
  return { regular, special };
}

/** Wikipedia titles to try for one chamber's election article, most likely first. */
export function wikiTitles(year, stateName, office) {
  const s = stateName;
  if (office === "state_senate") {
    if (s === "Nebraska") return [`${year} Nebraska Legislature election`];
    return [`${year} ${s} Senate election`, `${year} ${s} State Senate election`, `${year} ${s} Senate elections`, `${year} ${s} State Senate elections`];
  }
  return [`${year} ${s} House of Representatives election`, `${year} ${s} State House of Representatives election`,
    `${year} ${s} House of Delegates election`, `${year} ${s} State Assembly election`, `${year} ${s} House of Representatives elections`];
}

/** Last-name agreement: Wikipedia's incumbent vs ours (accents and suffixes ignored). */
export function sameSurname(a, b) {
  const last = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\(.*?\)|,?\s+(jr|sr|ii|iii|iv)\.?$/g, "").trim().split(/\s+/).pop() ?? "";
  const x = last(a), y = last(b);
  return x.length > 1 && x === y;
}
