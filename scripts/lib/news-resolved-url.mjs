/**
 * news-resolved-url.mjs: what counts as a real publisher URL for a news row,
 * and how to collapse rows that resolved to the same one.
 *
 * Two jobs:
 *
 * 1. isUsableResolvedUrl(): the resolver must never store an error page as the
 *    answer. The old headless resolver saved `chrome-error://chromewebdata/` on
 *    44 rows (2026-05). Because they all shared one value, they also looked
 *    like one 44-row duplicate group. An unusable URL means "not resolved yet":
 *    leave resolved_url NULL so the next run retries it. Migration 0330 applies
 *    the same rule in the database (public.is_usable_news_url), so every writer
 *    is held to it. Keep the two lists in step; tests/news-resolved-url.test.ts
 *    checks that they match.
 *
 * 2. planResolvedDedupe(): one story arrives under several Google News URLs,
 *    which collapse to one resolved_url only after resolve-news-urls runs.
 *    The insert trigger never saw the match (resolved_url is NULL at insert),
 *    so 7,511 twin rows piled up by 2026-11-24. This picks one keeper per
 *    resolved_url and lists what has to move to it before the rest can go.
 *    Pure: the script (scripts/dedupe-news-resolved.mjs) does the I/O.
 */

/** Hosts whose pages are never the article itself. */
export const BLOCKED_RESOLVED_HOSTS = [
  "news.google.com",      // the redirect we were trying to resolve
  "consent.google.com",   // Google's cookie wall
  "errors.edgesuite.net", // Akamai "Access Denied" page
];

/** True when `url` is an http(s) URL on a real host that is not an error page. */
export function isUsableResolvedUrl(url) {
  if (typeof url !== "string") return false;
  const u = url.trim();
  // chrome-error://, about:blank, data:, javascript: are all non-answers.
  if (!/^https?:\/\//i.test(u)) return false;
  let parsed;
  try { parsed = new URL(u); } catch { return false; }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return false; // localhost, bare names
  if (BLOCKED_RESOLVED_HOSTS.includes(host)) return false;
  // Google's "unusual traffic" interstitial.
  if (host === "google.com" && parsed.pathname.startsWith("/sorry")) return false;
  return true;
}

const time = (v) => (v ? Date.parse(v) || 0 : 0);

/**
 * Sort key for keeper choice; the lowest sorts first.
 *
 * Order, and why:
 *  1. active: an inactive row's /news page is already a 404, so keeping it
 *     over an active copy would take the story off every feed.
 *  2. body extracted: feeds list only extracted rows, and the text can't be
 *     moved. On 2026-11-24, putting "referenced" first would have kept a
 *     bodiless row in 85 groups and deleted the twin holding the article.
 *  3. referenced: rows that members reached (pushed, linked from an intel
 *     alert, a legislator mention, a press contact, a notification) keep their
 *     id, so links already out in the world still open. The references
 *     themselves move to whichever row is kept.
 *  4. already canonical (duplicate_of IS NULL).
 *  5. more references, then the oldest, then the lowest id (deterministic).
 */
export function keeperSortKey(row, refWeight = 0) {
  const referenced = refWeight > 0 || !!row.policy_alert_id || !!row.auto_pushed_at;
  return [
    row.active ? 0 : 1,
    row.body_extracted_at ? 0 : 1,
    referenced ? 0 : 1,
    row.duplicate_of ? 1 : 0,
    -refWeight,
    time(row.scraped_at),
    String(row.id),
  ];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * @param {Array<{id:string,resolved_url:string|null,duplicate_of:string|null,active:boolean,
 *   scraped_at:string|null,body_extracted_at:string|null,policy_alert_id:string|null,
 *   auto_pushed_at:string|null}>} rows  every row that has a resolved_url
 * @param {Map<string,number>} refWeight  references per row id (mentions, press,
 *   notifications, children); rows not in the map have none
 * @returns {{
 *   groups: Array<{resolved_url:string, keeper:string, losers:string[], held:string[]}>,
 *   deleteIds: string[],
 *   holdIds: string[],
 *   alertMoves: Array<{keeper:string, from:string, policy_alert_id:string}>,
 *   loserToKeeper: Map<string,string>,
 *   skippedUnusable: number,
 * }}
 */
export function planResolvedDedupe(rows, refWeight = new Map()) {
  const byUrl = new Map();
  let skippedUnusable = 0;
  for (const r of rows) {
    if (!r.resolved_url) continue;
    if (!isUsableResolvedUrl(r.resolved_url)) { skippedUnusable++; continue; }
    const list = byUrl.get(r.resolved_url);
    if (list) list.push(r); else byUrl.set(r.resolved_url, [r]);
  }

  const groups = [];
  const deleteIds = [];
  const holdIds = [];
  const alertMoves = [];
  const loserToKeeper = new Map();

  for (const [resolved_url, members] of byUrl) {
    if (members.length < 2) continue;
    const ranked = members
      .map((r) => ({ r, key: keeperSortKey(r, refWeight.get(r.id) ?? 0) }))
      .sort((a, b) => compareKeys(a.key, b.key))
      .map((x) => x.r);
    const keeper = ranked[0];

    // A row carries at most one intel-alert link. The keeper keeps its own,
    // or inherits the first loser's. A loser tied to a DIFFERENT alert is
    // held back (kept, marked as a duplicate) so that alert keeps its story.
    let alertId = keeper.policy_alert_id ?? null;
    const losers = [];
    const held = [];
    for (const r of ranked.slice(1)) {
      if (r.policy_alert_id && !alertId) {
        alertId = r.policy_alert_id;
        alertMoves.push({ keeper: keeper.id, from: r.id, policy_alert_id: r.policy_alert_id });
      }
      if (r.policy_alert_id && r.policy_alert_id !== alertId) {
        held.push(r.id);
        holdIds.push(r.id);
        continue;
      }
      losers.push(r.id);
      deleteIds.push(r.id);
      loserToKeeper.set(r.id, keeper.id);
    }
    groups.push({ resolved_url, keeper: keeper.id, losers, held });
  }

  return { groups, deleteIds, holdIds, alertMoves, loserToKeeper, skippedUnusable };
}

const NEWS_LINK = /\/news\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Rewrite every /news/<loser id> in a link to its keeper. Returns the new
 * string, or null when nothing in it changes.
 */
export function rewriteNewsLink(link, loserToKeeper) {
  if (typeof link !== "string") return null;
  let changed = false;
  const out = link.replace(NEWS_LINK, (whole, id) => {
    const keeper = loserToKeeper.get(id.toLowerCase());
    if (!keeper) return whole;
    changed = true;
    return `/news/${keeper}`;
  });
  return changed ? out : null;
}

/** Every news id a link points at (lower-case). */
export function newsIdsInLink(link) {
  if (typeof link !== "string") return [];
  return [...link.matchAll(NEWS_LINK)].map((m) => m[1].toLowerCase());
}
