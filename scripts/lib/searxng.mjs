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
 * Everything degrades gracefully: if SEARXNG_URL is unset or the instance is
 * unreachable, searxngSearch() returns [] and callers queue the locality for
 * later — they NEVER fall back to Gemini.
 */

export function searxngUrl() {
  const u = (process.env.SEARXNG_URL || "").trim().replace(/\/+$/, "");
  return u || null;
}

export function searxngConfigured() {
  return !!searxngUrl();
}

/**
 * @returns {Promise<Array<{title:string,url:string,content:string}>>} — [] on
 * any failure (unconfigured / down / non-200 / bad JSON).
 */
export async function searxngSearch(query, { count = 10, timeoutMs = 15_000 } = {}) {
  const base = searxngUrl();
  if (!base || !query) return [];
  try {
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0&language=en-US`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)", Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }))
      .filter((r) => r.url)
      .slice(0, count);
  } catch {
    return [];
  }
}
