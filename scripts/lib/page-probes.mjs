/**
 * page-probes.mjs — one live sample of each detail-page TYPE, for the hourly
 * watchdog (check-vercel-usage.mjs).
 *
 * WHY (2026-10-13): every /research/[id] page returned 500 for five weeks
 * (2026-09-08 → 10-13) and nothing noticed. The watchdog only fetched the home
 * page, and a page type breaks as a whole: one bad line in /research/[id]
 * takes down all 548 papers at once. One probe per type catches that within
 * the hour.
 *
 * The samples are STABLE (lowest id per table), so on a healthy site each
 * probe is answered from Cloudflare's or Netlify's cache: it costs no render
 * and no Supabase egress. A broken page is never cached, so it reaches the
 * origin and shows up here.
 */

/** @returns {Promise<Array<{kind: string, path: string}>>} */
export async function pageProbeTargets(sb) {
  const first = async (table, where) => {
    const { data } = await where(sb.from(table).select("id")).order("id").limit(1).maybeSingle();
    return data?.id ?? null;
  };
  const [bill, alert, paper, news, legislator] = await Promise.all([
    first("bills", (q) => q.eq("active", true)),
    first("policy_alerts", (q) => q.eq("moderation_status", "approved")),
    first("research_papers", (q) => q.eq("is_active", true)),
    first("news_items", (q) => q.eq("active", true)),
    first("legislators", (q) => q.eq("active", true).eq("level", "state")),
  ]);
  return [
    { kind: "State HQ", path: "/states/TX" },
    bill && { kind: "bill", path: `/bills/${bill}` },
    alert && { kind: "alert", path: `/alerts/${alert}` },
    paper && { kind: "research paper", path: `/research/${paper}` },
    news && { kind: "news article", path: `/news/${news}` },
    legislator && { kind: "legislator", path: `/legislators/${legislator}` },
  ].filter(Boolean);
}

/**
 * A page-type problem worth paging about, or null. 5xx only: a 404 can be a
 * row deactivated between the pick and the fetch, and a 403 carrying a CF-RAY
 * is Cloudflare challenging us, not an outage (see the site check).
 *
 * @param {{kind: string, path: string}} target
 * @param {number} status HTTP status, 0 when the fetch threw
 * @param {string | null} [errorMessage]
 * @returns {string | null}
 */
export function probeProblem({ kind, path }, status, errorMessage = null) {
  if (errorMessage) return `PAGE TYPE UNREACHABLE: ${kind} pages (${path}) — ${errorMessage}`;
  if (status >= 500) return `PAGE TYPE DOWN: ${kind} pages return ${status} (e.g. ${path})`;
  return null;
}
