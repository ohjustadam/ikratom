/**
 * searxng.mjs — thin client for a self-hosted SearXNG instance.
 *
 * SearXNG (github.com/searxng/searxng, AGPL) is a keyless, no-limit
 * metasearch engine. We run it locally (owner box / self-hosted runner) and
 * use its JSON API to FIND a locality's official .gov roster page — the step
 * Gemini's Google-Search grounding used to do — without any API key or quota.
 *
 * Deploy: see docs/SEARXNG_DEPLOY.md. Set SEARXNG_URL (e.g.
 * http://localhost:8080). JSON output must be enabled in settings.yml
 * (search.formats: [html, json]) or requests 403.
 *
 * Two doors into the same request, on purpose:
 *
 *   searxngSearch()         — degrades to [] on every failure. The shipped
 *     callers (ban-verify, officials-extract, clear-review-queues,
 *     research-stakeholder-stance) want results or nothing: on [] they queue
 *     the locality for later and NEVER fall back to Gemini.
 *
 *   searxngSearchDetailed() — same request, but reports WHY it came back
 *     empty, because "we could not search" and "we searched and found
 *     nothing" are different facts and only the first is a reason to declare
 *     a whole discovery run blocked rather than quietly successful.
 *
 *   searxngProbe()          — one control query, so a run can establish that
 *     up front instead of inferring it from a pile of empty result sets.
 */

export function searxngUrl() {
  const u = (process.env.SEARXNG_URL || "").trim().replace(/\/+$/, "");
  return u || null;
}

export function searxngConfigured() {
  return !!searxngUrl();
}

/**
 * @returns {Promise<{ok:boolean,status:number,reason:"ok"|"unconfigured"|"bad_query"|"timeout"|"network"|"http"|"bad_json",results:Array<{title:string,url:string,content:string,engine:string|null}>}>}
 *
 * WHY this exists: the old client returned [] for unset env, instance down,
 * 403-because-JSON-is-off, bad JSON AND a genuinely empty result set. "Could
 * not search" and "found nothing" are the exact distinction the
 * GROUNDING_UNAVAILABLE mechanism exists to report, and they were
 * indistinguishable through this door — an outage read as a clean, empty,
 * successful run forever.
 */
export async function searxngSearchDetailed(
  query,
  { count = 10, timeoutMs = 15_000, timeRange = null, language = "en-US" } = {},
) {
  const base = searxngUrl();
  if (!base) return { ok: false, status: 0, reason: "unconfigured", results: [] };
  if (!query) return { ok: false, status: 0, reason: "bad_query", results: [] };

  let res;
  try {
    let url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0&language=${encodeURIComponent(language)}`;
    if (timeRange) url += `&time_range=${encodeURIComponent(timeRange)}`;
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)", Accept: "application/json" },
    });
  } catch (e) {
    // An instance that is up but hung is a different operational fact from one
    // that refused the connection, and the abort's name differs by how it was
    // raised (TimeoutError from AbortSignal.timeout, AbortError from a plain
    // abort), so sniff as well as compare.
    const to = e?.name === "TimeoutError" || /abort|timeout/i.test(String(e?.name ?? e));
    return { ok: false, status: 0, reason: to ? "timeout" : "network", results: [] };
  }

  // 403 here is almost always settings.yml missing `json` in search.formats —
  // the instance is healthy, we just aren't allowed to read it. Carrying the
  // status out is what makes that diagnosable from a cron log.
  if (!res.ok) return { ok: false, status: res.status, reason: "http", results: [] };

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: res.status, reason: "bad_json", results: [] };
  }

  const results = (Array.isArray(data?.results) ? data.results : [])
    // engine is diagnostic only (which backend produced a lead when one of
    // them is throttled); the shipped callers read title/url/content and are
    // blind to the extra key.
    .map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "", engine: r.engine ?? null }))
    .filter((r) => r.url)
    .slice(0, count);
  return { ok: true, status: res.status, reason: "ok", results };
}

/**
 * @returns {Promise<Array<{title:string,url:string,content:string,engine:string|null}>>}
 * UNCHANGED contract: [] on any failure (unconfigured / down / non-200 / bad
 * JSON) as well as on a real empty result set. Do not "improve" this by
 * throwing or returning a status — four shipped callers read [] as "nothing
 * found, queue it and move on", and anything else here turns an outage into a
 * verdict. Callers that must tell the two apart use searxngSearchDetailed.
 */
export async function searxngSearch(query, opts = {}) {
  const r = await searxngSearchDetailed(query, opts);
  return r.ok ? r.results : [];
}

/**
 * Health probe. Requires >=2 results on a control query: an instance that is
 * UP but whose every engine is throttled answers 200 with an empty list, and
 * that is not a working search backend.
 *
 * @returns {Promise<{ok:boolean,reason:string,resultCount:number}>}
 */
export async function searxngProbe({ timeoutMs = 10_000 } = {}) {
  const r = await searxngSearchDetailed("city council meeting agenda", { count: 3, timeoutMs });
  if (!r.ok) return { ok: false, reason: r.reason, resultCount: 0 };
  const enough = r.results.length >= 2;
  return { ok: enough, reason: enough ? "ok" : "no_engines", resultCount: r.results.length };
}
