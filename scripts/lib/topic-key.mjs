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
