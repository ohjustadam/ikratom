// scripts/lib/topic-key.mjs
// Canonical topic-cluster keying for campaign dedup. Extracted VERBATIM from
// cleanup-pending-campaigns.mjs (the good version with the safe 'title:'
// fallback) so the daily janitor and the auto-approve engine cluster
// IDENTICALLY — a candidate the engine would approve is keyed the same way the
// janitor would supersede it.
//
// Deliberately NOT used by cleanup-stale-active-campaigns.mjs (its EVENT_RX is
// shorter and falls back to 'unknown'; repointing it would re-cluster already-
// promoted auto_active rows — a separate, dry-run-verified change). Also NOT the
// DB campaign_topic_key() function (0107), which keys at birth and is narrower;
// this lib keys at decision/cleanup time and is intentionally broader.

const KW_RX = /\b(kratom|mitragyna(?:[a-z]+)?|7-?o?h|gas[- ]?station)\b/i;
const EVENT_RX =
  /\b(ban|restrict|regulat|hearing|petition|schedul|crackdown|ordinance|enact|ruling|veto|sign|amend|advance|pass|repeal|reject|withdraw|approv|stall|halt|block|warn|advisor|action|sue|classif|control|emergenc|propos|introduc|vote)/i;

function normalize(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Topic-cluster key: `STATE|keyword|event` when both a kratom keyword and an
 * event word parse out of the title; otherwise a normalized-title fallback
 * (`title:<normalized>`) so we only ever collapse TRUE repeats, never distinct
 * events. State-null federal items cluster under "FED".
 */
export function topicKey(state, title) {
  const t = normalize(title);
  const kw = (t.match(KW_RX) || [])[1];
  const event = (t.match(EVENT_RX) || [])[1];
  if (!kw || !event) return `title:${t}`;
  return `${state || "FED"}|${kw}|${event}`;
}

/**
 * Second dedup axis: the exact normalized title. Catches near-identical
 * headlines whose topicKey parsed to the `title:` fallback OR to different
 * parseable keys but are literally the same story. Always `title:<normalized>`.
 */
export function normalizedTitleKey(title) {
  return `title:${normalize(title)}`;
}

/** True when a topicKey is the unparseable fallback (no confident kw+event). */
export function isFallbackKey(key) {
  return typeof key === "string" && key.startsWith("title:");
}

// STRICT event set — only unambiguous, SPECIFIC policy events. Used by the
// auto-approve engine's dedup (NOT the janitor): the broad EVENT_RX above
// includes generic words (action|propos|vote|advance|warn|...) that could
// cluster two genuinely-distinct events in the same state, and a wrong
// auto-SUPERSEDE silently buries a real call-to-action. So the engine only
// collapses on a strong shared event OR a near-identical title.
const STRONG_EVENT_RX = /\b(ban|restrict|schedul|hearing|enact|veto|repeal|ordinance|crackdown|prohibit|classif|outlaw)/i;

/**
 * Conservative topic key for the auto-approve engine's dedup. Returns
 * `STATE|keyword|strongEvent` ONLY when both a kratom keyword and a SPECIFIC
 * policy event parse; otherwise null (caller falls back to exact-title match).
 * Never collapses on a generic event word.
 */
export function strongTopicKey(state, title) {
  const t = normalize(title);
  const kw = (t.match(KW_RX) || [])[1];
  const ev = (t.match(STRONG_EVENT_RX) || [])[1];
  if (!kw || !ev) return null;
  return `${state || "FED"}|${kw}|${ev}`;
}

// Federal-story key. The national FDA/DEA 7-OH push is ONE story, but outlets
// report it with varying verbs (restrict / schedule / classify / crackdown / ban)
// and varying keywords (7-OH / mitragynine / kratom), so strongTopicKey produces
// a DIFFERENT FED|kw|event key per headline and they never collapse — every
// repackage becomes its own campaign and floods the feed. This keys federal
// kratom items COARSELY: one keyword bucket + one event bucket, so the whole
// scheduling push collapses to a single canonical federal campaign while genuinely
// distinct federal event TYPES (a hearing vs a repeal vs a veto) stay separate.
//
// Guard rails: only fires for federal/national campaigns (state null/FED/ALL),
// the title must carry a real federal signal (FDA/DEA/DOJ/Congress/nationwide —
// NOT bare "federal" or "Schedule I", which states use too), and it must be about
// kratom. Returns null otherwise (then strongTopicKey/title keys apply).
const FED_SIGNAL_RX = /\b(fda|dea|doj|justice department|congress(?:ional)?|nationwide|federal government|controlled substances act)\b/i;
function coarseFederalEvent(t) {
  // Leading-\b-only (prefix) matching, like EVENT_RX — so "scheduling"/"classify"/
  // "restriction"/"repealed" match. Check the PRO-kratom / distinct event TYPES
  // FIRST — a "move to repeal the ban" must bucket as 'repeal', not collapse into
  // the anti-kratom 'restrict' push (it also contains "ban"/"moves to"). Order matters.
  if (/\brepeal/i.test(t)) return "repeal";
  if (/\bveto/i.test(t)) return "veto";
  if (/\bhearing/i.test(t)) return "hearing";
  if (/\b(ban|restrict|schedul|classif|prohibit|crackdown|control|outlaw|seeks? to|moves? to|recommend|urges?|pushes?)/i.test(t)) return "restrict";
  return null;
}
export function federalTopicKey(state, title) {
  const st = String(state || "").toUpperCase();
  if (st && st !== "FED" && st !== "ALL") return null; // federal/national campaigns only
  // Test on the RAW title (not normalize()): normalize() turns "7-OH" into "7 oh",
  // which KW_RX (contiguous "7-?o?h") would miss — the very reason 7-OH headlines
  // never keyed before. The regexes are all \b-anchored + case-insensitive.
  const raw = String(title || "");
  if (!KW_RX.test(raw)) return null;        // must be about kratom / 7-OH
  if (!FED_SIGNAL_RX.test(raw)) return null; // must carry a federal signal
  const ev = coarseFederalEvent(raw);
  if (!ev) return null;
  return `fed|kratom|${ev}`;
}

// Bill-identifier key. Legislative-action alert titles ("TX HB 1097 — Reported
// engrossed", "UT HB 301 — Enrolled Bill Returned to House") carry NO kratom
// keyword, so topicKey/strongTopicKey can't cluster the many procedural steps of
// ONE bill — they'd each become a separate campaign. This extracts the bill
// number so all steps of the same bill collapse to a single campaign. Returns
// null when no bill number is present (then the title/topic keys apply).
const BILL_NUM_RX =
  /\b(?:([a-z]{2})\s+)?(hb|sb|hr|sr|hcr|scr|hjr|sjr|hjm|sjm|hcr|ab|sf|hf|lb|ld|sp|hp)\s*\.?\s*0*(\d{1,5})\b/i;
export function billKey(state, title) {
  const m = String(title || "").match(BILL_NUM_RX);
  if (!m) return null;
  const st = String(state || m[1] || "").toUpperCase();
  return `bill:${st}|${m[2].toLowerCase()}${m[3]}`;
}
