#!/usr/bin/env node
// Probes a reachable SearXNG instance (SEARXNG_URL) with the SAME query shape
// the real pipeline uses (scripts/lib/searxng.mjs), and reports per-query
// result counts + which engines actually answered vs went unresponsive.
//
// Purpose: measure datacenter-IP search degradation. Run it pointed at an
// in-job SearXNG container on a GitHub Actions runner (Azure IP) to decide
// whether relocating search off the residential box is viable. (Google will
// captcha; the question is whether the DDG/Brave/Qwant/Mojeek/Wikipedia
// aggregate still returns usable .gov + news results.)

const BASE = (process.env.SEARXNG_URL || "http://localhost:8080").replace(/\/+$/, "");

// Representative of the three real consumers: officials lookup, ban verify, sweep.
const QUERIES = [
  "Allegan County Michigan board of commissioners members",
  "Lewistown Montana city commission members",
  "Tulsa Oklahoma city council kratom ordinance",
  "San Jose California city council members 2026",
  "kratom ban repealed ordinance rescinded",
  "Greensboro North Carolina mayor city council",
];

async function probe(query) {
  const url = `${BASE}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0&language=en-US`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "iKratom Civic Data (contact@ikratom.org)", Accept: "application/json" },
    });
    if (!res.ok) return { query, ok: false, status: res.status, ms: Date.now() - started };
    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const engines = {};
    for (const r of results) for (const e of (r.engines || [r.engine]).filter(Boolean)) engines[e] = (engines[e] || 0) + 1;
    const unresponsive = (data?.unresponsive_engines || []).map((u) => Array.isArray(u) ? u.join(":") : String(u));
    const govHits = results.filter((r) => /\.gov(\/|$)/.test(r.url || "")).length;
    return {
      query, ok: true, status: 200, ms: Date.now() - started,
      count: results.length, govHits,
      topEngines: Object.entries(engines).sort((a, b) => b[1] - a[1]).slice(0, 6),
      unresponsive: unresponsive.slice(0, 12),
      sampleUrls: results.slice(0, 3).map((r) => r.url),
    };
  } catch (err) {
    return { query, ok: false, status: 0, ms: Date.now() - started, error: String(err?.name || err).slice(0, 60) };
  }
}

console.log(`searxng probe — ${BASE}\n`);
const out = [];
for (const q of QUERIES) {
  const r = await probe(q);
  out.push(r);
  if (r.ok) {
    console.log(`OK   "${q.slice(0, 44)}" → ${String(r.count).padStart(3)} results, ${r.govHits} .gov, ${r.ms}ms`);
    console.log(`     engines: ${r.topEngines.map(([e, n]) => `${e}:${n}`).join("  ") || "(none)"}`);
    if (r.unresponsive.length) console.log(`     unresponsive: ${r.unresponsive.join(", ")}`);
  } else {
    console.log(`FAIL "${q.slice(0, 44)}" → HTTP ${r.status} ${r.error || ""}`);
  }
}
const okCount = out.filter((r) => r.ok && r.count > 0).length;
const totalResults = out.reduce((s, r) => s + (r.count || 0), 0);
console.log(`\nsearxng scoreboard: ${okCount}/${QUERIES.length} queries returned results; ${totalResults} total hits`);
console.log(JSON.stringify({ base: BASE, okCount, total: QUERIES.length, totalResults, out }, null, 0));
