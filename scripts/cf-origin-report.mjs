#!/usr/bin/env node
/**
 * cf-origin-report.mjs — who is spending the Netlify compute, from Cloudflare's
 * edge analytics.
 *
 * WHY (2026-10-02): Netlify exposes NO per-meter or per-invocation usage on any
 * API (verified against its OpenAPI spec), and its function logs are retained
 * 24h and will not load once the site is paused. A ~25-minute bot flood burned
 * ~635 of 1000 monthly credits and took the site down, and the only place the
 * evidence survived was Cloudflare, which already fronts the domain.
 *
 * "compute proxy" = requests that reached the origin x their time-to-first-byte.
 * It UNDER-counts (streamed bodies and timed-out invocations keep billing after
 * the first byte) but ranks sources correctly, which is the question that
 * matters in an incident. Cloudflare reports -1 for requests it answered itself.
 *
 *   node --env-file=.env.local scripts/cf-origin-report.mjs                 # last 24h
 *   node --env-file=.env.local scripts/cf-origin-report.mjs --from 2026-10-02T00:00:00Z --to 2026-10-02T03:30:00Z
 *   node --env-file=.env.local scripts/cf-origin-report.mjs --bucket datetimeFiveMinutes
 *
 * Needs CLOUDFLARE_CACHE_TOKEN (Analytics:Read on the zone). That token CANNOT
 * read or write WAF/rate-limit rules — creating a shield needs a different one.
 */
const TOKEN = process.env.CLOUDFLARE_CACHE_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const ZONE = process.env.CLOUDFLARE_ZONE_ID || "6f054a2b237f9b7ec10d525ec7e99d05"; // ikratom.org
if (!TOKEN) { console.error("CLOUDFLARE_CACHE_TOKEN not set"); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const to = arg("to", new Date().toISOString());
const from = arg("from", new Date(Date.parse(to) - 24 * 3600e3).toISOString());
const bucket = arg("bucket", "datetimeHour");

async function groups(dims, order, limit, extra = "") {
  const q = `{viewer{zones(filter:{zoneTag:"${ZONE}"}){g:httpRequestsAdaptiveGroups(limit:${limit},orderBy:[${order}],` +
    `filter:{datetime_geq:"${from}",datetime_leq:"${to}"${extra}}){count dimensions{${dims}} avg{originResponseDurationMs} sum{edgeResponseBytes}}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data.viewer.zones[0].g.map((x) => ({
    n: x.count, key: Object.values(x.dimensions).join(" | "),
    ms: Math.max(0, x.avg.originResponseDurationMs ?? 0), mb: (x.sum.edgeResponseBytes ?? 0) / 1e6,
  }));
}
const row = (r) => `${String(r.n).padStart(7)}  ${String(Math.round((r.n * r.ms) / 1000)).padStart(7)}s  ${String(Math.round(r.ms)).padStart(6)}ms  ${r.key.slice(0, 120)}`;
const section = (t, rows) => { console.log(`\n== ${t}\n   count  originSec   avgTTFB  key`); rows.forEach((r) => console.log(row(r))); };

console.log(`Cloudflare origin report  ${from} -> ${to}`);
section("status mix (edge | origin)", await groups("edgeResponseStatus originResponseStatus", "count_DESC", 12));
section("top user agents by request count", await groups("userAgent", "count_DESC", 8));
section("top paths", await groups("clientRequestPath edgeResponseStatus", "count_DESC", 15));
section("slow origin (>5s) - where timeouts come from", await groups("clientRequestPath edgeResponseStatus", "count_DESC", 12, ",originResponseDurationMs_gt:5000"));
section(`timeline (${bucket})`, await groups(bucket, `${bucket}_ASC`, 60));
