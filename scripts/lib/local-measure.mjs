/**
 * local-measure.mjs — is a "pending measure" note about this locality's OWN
 * government?
 *
 * The locality sweep asks a model for pending measures on each page. Local news
 * sites report state bills, so state items landed on city rows: Oklahoma City
 * showed Rep. Turner's planned Schedule I bill as a pending local measure, and
 * Flint a bill heading to the Michigan Senate. Members read those notes on
 * their dashboards as action by their own city.
 *
 * A note is dropped only when it names a state-level actor and no local one. A
 * council asking the legislature to act is still local action, so it stays.
 */
const STATE_ACTOR = new RegExp([
  String.raw`\bstate (rep(resentative)?|sen(ator)?|legislat\w+|lawmakers?)\b`,
  String.raw`\b(general assembly|statehouse|capitol|statewide|interim study|governor|attorney general|congress|lawmakers)\b`,
  String.raw`\b(house|senate|assembly) bill\b`,
  String.raw`\b(house|senate) (committee|floor|deputy|majority|minority)\b`,
  String.raw`\bthe (house|senate)\b`,
  String.raw`\b[hs]\.?b\.? ?\d+`,
  String.raw`\b[sa]\d{3,5}[a-z]?\b`,
  String.raw`\b\d{4}-[hs] ?\d+`,
  String.raw`\b(rep|sen)\. `,
].join("|"), "i");

const LOCAL_ACTOR = new RegExp([
  String.raw`\b(city|town|village|borough|township|parish|county) (council|commission\w*|board|legislature|supervisors?|manager|attorney|administrator)\b`,
  String.raw`\b(selectboard|selectmen|aldermen|alderman|alders?|council(man|woman|member|or)s?|commissioners?|supervisors|mayor|ordinance|local law|zoning)\b`,
  String.raw`\bboard of (health|supervisors|commissioners|aldermen|selectmen|trustees)\b`,
  String.raw`\bplanning (board|commission)\b`,
  String.raw`\bald\. `,
].join("|"), "i");

/** False only for a note that is plainly a state or federal item. */
export function isLocalMeasure(note, stateName = "") {
  const text = String(note ?? "");
  if (!text.trim()) return false;
  if (LOCAL_ACTOR.test(text)) return true;
  if (STATE_ACTOR.test(text)) return false;
  if (stateName && new RegExp(String.raw`\b${stateName}\s+(law|bill|house|senate|legislat\w+|statute|general)\b`, "i").test(text)) return false;
  return true;
}
