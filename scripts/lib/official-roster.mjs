/**
 * official-roster.mjs: is a person on a chamber's own member list?
 *
 * The officials-turnover engine needs a second source before anyone leaves
 * office. Until 2026-11 that was only openstates/people, and after the
 * 2026 general it lagged for weeks: Florida, Indiana, Tennessee, South
 * Carolina, Alabama, Delaware, Hawaii and Oklahoma were last updated in
 * October, so 167 seats whose new members had already been sworn in could
 * not change hands. The chamber's own website is the better second source:
 * flsenate.gov, scstatehouse.gov and capitol.tn.gov listed every one of the
 * newcomers within days.
 *
 * Pure functions, no I/O. A page must VOUCH for the chamber first: most of the
 * members we already know are staying have to be on it. That one rule keeps out
 * error pages, a caucus page that lists one party, a stale copy, and a page
 * for the other chamber.
 */
import { sameFullName } from "./term-calendar.mjs";
import { extractEmails, surnameKeys, givenNames, carriesSurname, nameFits, domainOf } from "./roster-emails.mjs";

export const MIN_COVERAGE = 0.85; // continuing members a page must list to vouch for the chamber
export const MIN_CONTINUING = 5;

const SUFFIX = /^(jr|sr|ii|iii|iv|v|phd|md|esq)$/;
const PARTICLES = new Set(["van", "von", "de", "del", "della", "der", "den", "di", "da", "du", "la", "le", "st", "mc", "mac"]);
const plain = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Page text as tokens. Table cells, list items, line breaks and blocks become
 * a "|" token, so a name is never read across two entries; a comma stays a
 * token, so "Smith, John" can be read.
 */
export function pageTokens(html) {
  const json = jsonText(html);
  if (json != null) return pageTokens(json);
  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ")
    .replace(/<\/(td|th|li|p|div|tr|h[1-6]|option|dd|dt|section|article)>|<br\s*\/?>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xa0;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&#39;|&#x27;|&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi, " ");
  return plain(text).replace(/[|]/g, " | ").replace(/,/g, " , ")
    .replace(/[^a-z'\-|, ]+/g, " ").split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, "")).filter(Boolean);
}

/**
 * A JSON roster (Delaware's member lists are JSON) as one entry per record:
 * each record's text fields, with "|" between records.
 */
function jsonText(body) {
  const s = String(body ?? "").trimStart();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  let data; try { data = JSON.parse(s); } catch { return null; }
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      const own = Object.values(v).filter((x) => typeof x === "string" && x.length < 120 && !/^https?:/.test(x));
      if (own.length) out.push(own.join(" ; "));
      return Object.values(v).filter((x) => x && typeof x === "object").forEach(walk);
    }
  };
  walk(data);
  return out.map((x) => `<li>${x.replace(/[<>]/g, " ")}</li>`).join("");
}

/** Positions of every token, built once per page. */
export function indexTokens(tokens) {
  const at = new Map();
  tokens.forEach((t, i) => (at.get(t) ?? at.set(t, []).get(t)).push(i));
  return { tokens, at };
}

/** A name's surname words (particles kept: "van schoiack") and its given names. */
export function nameParts(name) {
  const words = plain(name).replace(/\(.*?\)/g, " ").replace(/"[^"]*"/g, " ")
    .replace(/[^a-z'\- ]+/g, " ").split(/\s+/).map((w) => w.replace(/^[-']+|[-']+$/g, ""))
    .filter((w) => w && !SUFFIX.test(w));
  if (words.length < 2) return null;
  let s = words.length - 1;
  while (s > 1 && PARTICLES.has(words[s - 1])) s--;
  const front = words.slice(0, s);
  const given = front.filter((w) => w.length > 1);
  // "T.J. Roberts", "R.J. Hawk": the initials are the first name.
  const initials = front.filter((w) => w.length === 1).join("");
  if (initials.length > 1) given.unshift(initials);
  return { surname: words.slice(s), given };
}

/** Short forms a member list may spell out (Dave for David). More than term-calendar's, because here a miss is only a miss. */
const SHORT = [
  ["david", "dave"], ["thomas", "tom", "tommy"], ["edward", "ed", "eddie"], ["joseph", "joe", "joey"], ["andrew", "andy", "drew"],
  ["charles", "charlie", "chuck"], ["susan", "sue", "suzy"], ["angela", "angie"], ["patricia", "patty", "pat", "tricia"],
  ["james", "jim", "jimmy", "jimmie", "jamie"], ["michael", "mike", "mick"], ["william", "bill", "billy", "will", "willie"],
  ["robert", "bob", "bobby", "rob", "robbie"], ["richard", "rick", "ricky", "dick", "rich"], ["kenneth", "ken", "kenny"],
  ["daniel", "dan", "danny"], ["christopher", "chris"], ["matthew", "matt"], ["anthony", "tony"], ["timothy", "tim"],
  ["gregory", "greg"], ["jeffrey", "jeff"], ["stephen", "steven", "steve"], ["donald", "don", "donnie"], ["ronald", "ron", "ronnie"],
  ["samuel", "sam"], ["benjamin", "ben"], ["nicholas", "nick"], ["zachary", "zack", "zach"], ["katherine", "catherine", "kathy", "kate", "katie"],
  ["elizabeth", "liz", "beth", "betsy", "betty", "lisa"], ["margaret", "peggy", "maggie"], ["deborah", "debra", "debbie", "deb"],
  ["rebecca", "becky"], ["jennifer", "jenny", "jen"], ["frederick", "fred"], ["gerald", "jerry"], ["lawrence", "larry"],
  ["raymond", "ray"], ["douglas", "doug"], ["philip", "phillip", "phil"], ["alexander", "alex"], ["joshua", "josh"],
  ["peter", "pete"], ["leonard", "len", "lenny"], ["vincent", "vince", "vinney", "vinny"], ["woodrow", "woody"], ["harold", "hal"],
  ["henry", "hank"], ["john", "jack", "johnny"], ["jonathan", "jon"], ["randall", "randy"], ["terrence", "terry"], ["walter", "walt"],
];
const shortFor = (a, b) => SHORT.some((set) => set.includes(a) && set.includes(b));
const sameGiven = (a, b, sur) => shortFor(a, b) || sameFullName(`${a} ${sur}`, `${b} ${sur}`);

/**
 * Is this person on the page? The surname must be there, and next to it, in the
 * same entry, one of their given names (or a known short form: Bill for
 * William). "Rep. Marshall Rawson", "Rawson, Marshall" and "Marshall J. Rawson
 * (R)" all count; a Rawson with another first name does not.
 */
export function nameOnPage(name, page, { loose = false } = {}) {
  const p = nameParts(name);
  if (!p || !p.given.length) return false;
  const { tokens, at } = page;
  const last = p.surname.at(-1), joined = p.surname.join(""), sur = joined;
  const starts = [];
  for (const i of at.get(joined) ?? []) starts.push([i, i]);
  if (p.surname.length > 1) {
    for (const i of at.get(last) ?? []) {
      const s = i - (p.surname.length - 1);
      if (s >= 0 && p.surname.every((w, k) => tokens[s + k] === w)) starts.push([s, i]);
    }
  }
  if (last.includes("-")) for (const part of last.split("-").filter((x) => x.length > 2)) for (const i of at.get(part) ?? []) starts.push([i, i]);
  // Loose (the same first letter) is for proving someone is NOT there, and for
  // checking a page lists the chamber. Strict (the same name, or a short form
  // of it) is for proving a newcomer is.
  const isGiven = (t) => t && t.length > 1 && p.given.some((g) => (loose ? g[0] === t[0] : sameGiven(g, t, sur)));
  for (const [s, e] of starts) {
    // "Marshall J. Rawson": up to two words back, never across an entry.
    let run = "";
    for (let j = s - 1, n = 0; j >= 0 && n < 3; j--, n++) {
      if (tokens[j] === "|" || tokens[j] === ",") break;
      if (isGiven(tokens[j])) return true;
      run = tokens[j].length === 1 ? tokens[j] + run : ""; // "t j roberts"
      if (run.length > 1 && p.given.includes(run)) return true;
    }
    // "Rawson, Marshall J."
    if (tokens[e + 1] === ",") for (let k = e + 2; k <= e + 3 && k < tokens.length; k++) {
      if (tokens[k] === "|" || tokens[k] === ",") break;
      if (isGiven(tokens[k])) return true;
    }
  }
  return false;
}

/**
 * Does the page vouch for the chamber? Share of the members we expect to stay
 * (re-elected, or not up this cycle) that the page lists.
 * @param {string[]} continuing  their names
 */
export function vouch(continuing, page) {
  const missing = continuing.filter((n) => !nameOnPage(n, page, { loose: true }));
  const listed = continuing.length - missing.length;
  const coverage = continuing.length ? listed / continuing.length : 0;
  return { listed, coverage, missing, vouches: continuing.length >= MIN_CONTINUING && coverage >= MIN_COVERAGE };
}

/**
 * What the page says about one seat changing hands.
 *   "in"      every winner is listed and the outgoing member is not
 *   "both"    winner and outgoing member are both listed (page not updated yet,
 *             or a member who moved chambers): hold
 *   "absent"  a winner is not listed yet
 */
export function seatEvidence(seat, page) {
  const winners = String(seat.winner_name ?? "").split(/,\s*/).filter(Boolean);
  if (!winners.length || !winners.every((w) => nameOnPage(w, page))) return "absent";
  if (seat.incumbent_name && nameOnPage(seat.incumbent_name, page, { loose: true })) return "both";
  return "in";
}

/**
 * The one address on the page that is this person's: it carries their surname,
 * the rest of it is a title or their own first name, and nobody else we list
 * uses it. Printed on the chamber's page, never guessed.
 * @param {Set<string>} taken  lowercase addresses already on someone else's row
 */
export function emailFor(name, html, pageUrl, taken = new Set()) {
  const keys = surnameKeys(null, name);
  if (!keys.length) return null;
  const given = givenNames(name, null, keys);
  let host = "";
  try { host = new URL(pageUrl).hostname.toLowerCase(); } catch { /* no host */ }
  const site = host.split(".").slice(-2).join(".");
  const fits = [...extractEmails(html).keys()].filter((e) => {
    const d = domainOf(e);
    const official = d.endsWith(".gov") || d.endsWith(".us") || (site && (d === site || d.endsWith(`.${site}`)));
    return official && carriesSurname(e, keys) && nameFits(e, keys, given) && !taken.has(e.toLowerCase());
  });
  return fits.length === 1 ? fits[0] : null;
}

/** Official member lists to try when the pages openstates/people cites are gone or built by JavaScript. */
export const SEED_PAGES = {
  "AR-state_house": ["https://www.arkleg.state.ar.us/Legislators/List"],
  "AR-state_senate": ["https://www.arkleg.state.ar.us/Legislators/List"],
  "DE-state_house": [{ url: "https://legis.delaware.gov/json/House/GetRepresentatives", method: "POST" }],
  "DE-state_senate": [{ url: "https://legis.delaware.gov/json/Senate/GetSenators", method: "POST" }],
  "FL-state_house": ["https://www.flhouse.gov/representatives"],
  // Indiana: the chamber site is built by JavaScript; each caucus lists its own members.
  "IN-state_house": ["https://www.indianahouserepublicans.com/index.php?src=directory&view=members&submenu=member_listing&srctype=members_lister&pos=0,100,100", "https://indianahousedemocrats.org/members"],
  "IN-state_senate": ["https://www.indianasenaterepublicans.com/senators", "https://www.indianasenatedemocrats.org/senators/"],
  "OK-state_house": ["https://www.okhouse.gov/representatives"],
};

/** A member list from openstates/people that names an old session ("2023/2023R") is a past roster, not today's. */
export function pastSession(url, year) {
  const years = [...String(url).matchAll(/(?<!\d)(20\d\d)(?!\d)/g)].map((m) => Number(m[1]));
  return years.length > 0 && Math.max(...years) < year - 1;
}
