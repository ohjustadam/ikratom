#!/usr/bin/env node
/**
 * email-clicks.mjs — how often members click through from each kind of email.
 *
 * WHY (owner, 2026-10-29): before deciding how much of a story an email should
 * carry (all of it, or a teaser that brings readers to the site), measure two
 * weeks of real clicks. Every iKratom link in a member email goes through
 * /e/<kind>/<page>, which src/app/e/[kind]/[[...path]]/route.ts 302s to <page>. Cloudflare keeps about
 * 31 days of per-path request counts on the free plan, so this needs no table,
 * no cron and no record of who clicked: it names the email, never the person.
 *
 *   node --env-file=.env.local scripts/email-clicks.mjs            # last 14 days
 *   node --env-file=.env.local scripts/email-clicks.mjs --days 7
 *
 * Clicks = redirects Cloudflare served on /e/ paths, minus known bot user
 * agents. A reader who first gets a bot challenge counts once, after passing
 * it. Emails = members reached by sends whose links were tagged ("links
 * tagged" in the scraper_runs note), so plain-link sends don't dilute the rate.
 */
import { createClient } from "@supabase/supabase-js";
import { parseClickPath } from "./lib/email-render.mjs";

const TOKEN = process.env.CLOUDFLARE_CACHE_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const ZONE = process.env.CLOUDFLARE_ZONE_ID || "6f054a2b237f9b7ec10d525ec7e99d05"; // ikratom.org
if (!TOKEN) { console.error("CLOUDFLARE_CACHE_TOKEN not set"); process.exit(1); }

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const days = Math.min(30, Math.max(1, Number(arg("days", 14))));
const to = new Date().toISOString();
const from = new Date(Date.now() - days * 864e5).toISOString();

// Which scraper_runs source sends each kind of email. Reports go out through
// the announcement sender, so the two are counted as one row.
const ROW_OF = { digest: "digest", hearing: "hearing", announce: "announce", report: "announce" };
const SOURCE_OF = { digest: "email_digest", hearing: "email_meeting_alerts", announce: "email_announcement" };
const BOT = /bot|crawl|spider|slurp|preview|scan|python|curl|wget|httpx|go-http|headless|monitor/i;

async function cloudflareClicks() {
  const q = `{viewer{zones(filter:{zoneTag:"${ZONE}"}){g:httpRequestsAdaptiveGroups(limit:10000,orderBy:[count_DESC],` +
    `filter:{datetime_geq:"${from}",datetime_leq:"${to}",clientRequestPath_like:"/e/%",edgeResponseStatus_geq:300,edgeResponseStatus_lt:400})` +
    `{count dimensions{date clientRequestPath userAgent}}}}}`;
  const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ query: q }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(`Cloudflare: ${j.errors[0].message}`);
  return j.data.viewer.zones[0].g;
}

async function taggedSends() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.from("scraper_runs").select("source, started_at, rows_updated")
    .in("source", [...new Set(Object.values(SOURCE_OF))]).gte("started_at", from).ilike("notes", "%links tagged%").limit(5000);
  if (error) throw new Error(`scraper_runs: ${error.message}`);
  return data;
}

const [rows, sends] = await Promise.all([cloudflareClicks(), taggedSends()]);
const byRow = {}, byPage = {}, byDay = {};
let bots = 0;
for (const r of rows) {
  const c = parseClickPath(r.dimensions.clientRequestPath);
  if (!c) continue;
  if (BOT.test(r.dimensions.userAgent ?? "")) { bots += r.count; continue; }
  const row = ROW_OF[c.kind] ?? c.kind;
  byRow[row] = (byRow[row] ?? 0) + r.count;
  byPage[c.page] = (byPage[c.page] ?? 0) + r.count;
  byDay[r.dimensions.date] = (byDay[r.dimensions.date] ?? 0) + r.count;
}
const sent = {};
for (const s of sends) sent[s.source] = (sent[s.source] ?? 0) + (s.rows_updated ?? 0);
const firstTagged = sends.map((s) => s.started_at).sort()[0];

console.log(`Email clicks, last ${days} days (${from.slice(0, 10)} to ${to.slice(0, 10)})`);
console.log(firstTagged ? `First tagged send: ${firstTagged.slice(0, 16).replace("T", " ")} UTC` : "No email has gone out with tagged links in this window yet.");
console.log("\nemail      emails  clicks  per 100 emails");
for (const row of new Set([...Object.keys(SOURCE_OF), ...Object.keys(byRow)])) {
  const emails = sent[SOURCE_OF[row]] ?? 0, clicks = byRow[row] ?? 0;
  if (!emails && !clicks) continue;
  console.log(`${row.padEnd(9)} ${String(emails).padStart(7)} ${String(clicks).padStart(7)} ${emails ? ((100 * clicks) / emails).toFixed(1).padStart(15) : "              -"}`);
}
console.log("\nPages clicked");
for (const [p, n] of Object.entries(byPage).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`${String(n).padStart(6)}  ${p}`);
console.log("\nBy day");
for (const [d, n] of Object.entries(byDay).sort()) console.log(`${d}  ${n}`);
if (bots) console.log(`\n(${bots} requests from bot user agents left out)`);
