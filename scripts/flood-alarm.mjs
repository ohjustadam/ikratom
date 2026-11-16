#!/usr/bin/env node
/**
 * flood-alarm.mjs — page the owner when bots start spending the server.
 *
 * WHY (2026-11-11): at 13:30Z a residential-proxy crawl (6,446 requests from
 * 1,171 IPs, at most 25 per IP, 2023-era Chrome/Firefox user agents) cost
 * 5,105 origin-seconds in ten minutes, most of a normal day's Netlify server
 * time. Nobody knew what it was until a session read Cloudflare a day later.
 * Re-reading the week showed the SAME crawler every day around 13:00-13:40Z.
 *
 * The hosting watchdog (check-vercel-usage.mjs) had an hour-level check, but:
 *  - it looked only at the trailing hour of an every-2-hours job, so half of
 *    every day was unwatched (the 11-09 12:50Z burst fell in that gap);
 *  - it multiplied ALL requests by the origin average, so challenged and
 *    cached requests counted as server time (it read 15,526 for 5,105);
 *  - its page said "run cf-origin-report", not who or what.
 *
 * This job reads Cloudflare GraphQL (httpRequestsAdaptiveGroups) with the
 * analytics-read CLOUDFLARE_CACHE_TOKEN, sums origin time per 5-minute bucket
 * for EVERYTHING since its last scan (so a dropped or late run leaves no gap),
 * and compares each bucket and each rolling hour with the last 7 days
 * (scripts/lib/flood-detector.mjs). A flood pages the owner ONLY — web push
 * to the owner's own subscriptions plus ntfy/email (scripts/lib/owner-alert.mjs).
 * It makes no request to the site, so it costs no Netlify credits.
 *
 * Self-healing: Cloudflare calls retry with backoff. A failed scan records
 * BLIND and does not advance scanned_to, so the next run rescans the gap.
 * Three blind runs in a row page the owner once a day: an alarm with no eyes
 * must say so.
 *
 *   node --env-file=.env.local scripts/flood-alarm.mjs                # live
 *   node --env-file=.env.local scripts/flood-alarm.mjs --dry-run      # no page, no telemetry
 *   node --env-file=.env.local scripts/flood-alarm.mjs --dry-run --from 2026-11-11T13:00:00Z --to 2026-11-11T14:30:00Z
 *
 * Telemetry source: flood_alarm. status "error" means FIRING or BLIND (same
 * convention as egress_watchdog), not that the job crashed.
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import {
  STEP_MS, densify, detect, planScan, rollupPaths, challengedShare, shortUA,
} from "./lib/flood-detector.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const DRY = argv.includes("--dry-run");
const TOKEN = process.env.CLOUDFLARE_CACHE_TOKEN;
const ZONE = process.env.CLOUDFLARE_ZONE_ID || "6f054a2b237f9b7ec10d525ec7e99d05"; // ikratom.org
const SOURCE = "flood_alarm";
const REPAGE_HOURS = 3;
const t0 = new Date();

const sb = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => Math.round(n).toLocaleString("en-US");
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
const day = (ms) => new Date(ms).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

async function gql(query, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch("https://api.cloudflare.com/client/v4/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j.errors?.length) {
        const msg = j.errors[0].message;
        // Auth and query-shape errors will not fix themselves; don't burn retries.
        if (/auth|permission|unknown field|cannot query|parse/i.test(msg)) throw Object.assign(new Error(msg), { fatal: true });
        throw new Error(msg);
      }
      return j.data.viewer.zones[0];
    } catch (e) {
      last = e;
      if (e.fatal) break;
      if (i < attempts - 1) await sleep(2000 * 3 ** i);
    }
  }
  throw last;
}

const win = (a, b) => `datetime_geq:"${new Date(a).toISOString()}",datetime_lt:"${new Date(b).toISOString()}"`;

async function fetchBuckets(fromMs, toMs) {
  const z = await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){g:httpRequestsAdaptiveGroups(limit:10000,` +
    `orderBy:[datetimeFiveMinutes_ASC],filter:{${win(fromMs, toMs)},originResponseDurationMs_gt:0}){` +
    `dimensions{datetimeFiveMinutes} sum{originResponseDurationMs}}}}}`);
  return z.g.map((x) => ({ t: x.dimensions.datetimeFiveMinutes, sec: x.sum.originResponseDurationMs / 1000 }));
}

async function fetchDetail(fromMs, toMs) {
  const w = win(fromMs, toMs);
  const z = await gql(`{viewer{zones(filter:{zoneTag:"${ZONE}"}){
    tot:httpRequestsAdaptiveGroups(limit:1,filter:{${w}}){count}
    org:httpRequestsAdaptiveGroups(limit:1,filter:{${w},originResponseDurationMs_gt:0}){count sum{originResponseDurationMs}}
    sec:httpRequestsAdaptiveGroups(limit:50,orderBy:[count_DESC],filter:{${w}}){count dimensions{securityAction}}
    ua:httpRequestsAdaptiveGroups(limit:5,orderBy:[count_DESC],filter:{${w}}){count dimensions{userAgent}}
    cty:httpRequestsAdaptiveGroups(limit:5,orderBy:[count_DESC],filter:{${w}}){count dimensions{clientCountryName}}
    ips:httpRequestsAdaptiveGroups(limit:10000,orderBy:[count_DESC],filter:{${w}}){count dimensions{clientIP}}
    paths:httpRequestsAdaptiveGroups(limit:10000,orderBy:[count_DESC],filter:{${w}}){count dimensions{clientRequestPath} sum{originResponseDurationMs}}
  }}}`);
  const total = z.tot[0]?.count ?? 0;
  return {
    total,
    originReqs: z.org[0]?.count ?? 0,
    originSec: (z.org[0]?.sum.originResponseDurationMs ?? 0) / 1000,
    challenged: challengedShare(z.sec.map((r) => ({ action: r.dimensions.securityAction, n: r.count }))),
    challengedN: z.sec.filter((r) => /challenge|block|close|drop/i.test(r.dimensions.securityAction) && !/solved|bypass|skip/i.test(r.dimensions.securityAction)).reduce((s, r) => s + r.count, 0),
    uas: z.ua.map((r) => ({ ua: shortUA(r.dimensions.userAgent), n: r.count })),
    countries: z.cty.map((r) => ({ c: r.dimensions.clientCountryName, n: r.count })),
    ipCount: z.ips.length,
    ipCapped: z.ips.length >= 10000,
    maxPerIp: z.ips[0]?.count ?? 0,
    paths: rollupPaths(z.paths.map((r) => ({ path: r.dimensions.clientRequestPath, n: r.count, sec: (r.sum.originResponseDurationMs ?? 0) / 1000 })), 4),
  };
}

function alertText(burst, d, det, avgDaySec, others) {
  const pct = (n) => `${Math.round((100 * n) / Math.max(1, d.total))}%`;
  const lines = [
    `${fmt(burst.sec)} origin-seconds in ${hhmm(burst.start)}-${hhmm(burst.end)} UTC ${day(burst.start)}`
      + (avgDaySec > 0 ? ` (~${Math.round((100 * burst.sec) / avgDaySec)}% of an average day's server time).` : "."),
    `Normal: up to ${fmt(det.thresholds.bucketBase)}s per 5 min, ${fmt(det.thresholds.hourBase)}s per hour (7-day p99/p90).`,
    `Requests: ${fmt(d.total)} (${fmt(d.originReqs)} reached the server) from ${d.ipCapped ? "10,000+" : fmt(d.ipCount)} IPs, at most ${fmt(d.maxPerIp)} per IP.`,
    `Cloudflare rules challenged ${pct(d.challengedN)} (${fmt(d.challengedN)}).`,
    `Top user agents: ${d.uas.map((u) => `${u.ua} ${fmt(u.n)}`).join(", ")}.`,
    `Server time by path: ${d.paths.map((p) => `${p.family} ${fmt(p.sec)}s/${fmt(p.n)} req`).join(", ")}.`,
    `Countries: ${d.countries.map((c) => `${c.c} ${pct(c.n)}`).join(", ")}.`,
  ];
  if (others.length) lines.push(`Also this scan: ${others.map((b) => `${hhmm(b.start)}-${hhmm(b.end)} ${fmt(b.sec)}s`).join(", ")}.`);
  lines.push(`Detail: node --env-file=.env.local scripts/cf-origin-report.mjs --from ${new Date(burst.start).toISOString()} --to ${new Date(burst.end).toISOString()}`);
  return lines.join("\n");
}

async function pageOwner({ title, body }) {
  const sent = { push: "off" };
  try {
    const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).maybeSingle();
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
    if (owner && pub && priv) {
      const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", owner.id);
      const webpush = createRequire(import.meta.url)("web-push");
      webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@ikratom.org", pub, priv);
      let ok = 0;
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title, body: body.slice(0, 300), link: "/admin/ops", tag: "flood-alarm" }), { TTL: 6 * 3600 });
          ok++;
        } catch { /* per-subscription best-effort */ }
      }
      sent.push = `${ok}/${subs?.length ?? 0}`;
    }
  } catch (e) { sent.push = `failed ${e.message}`; }
  const { alertOwner } = await import("./lib/owner-alert.mjs");
  Object.assign(sent, await alertOwner({ sb, title, body, priority: "urgent", link: "https://dash.cloudflare.com/", tags: ["rotating_light"] }));
  return sent;
}

async function recentRows(hours) {
  if (!sb) return [];
  const { data } = await sb.from("scraper_runs").select("finished_at, notes")
    .eq("source", SOURCE).gte("finished_at", new Date(Date.now() - hours * 3600e3).toISOString())
    .order("finished_at", { ascending: false }).limit(50);
  return data ?? [];
}

async function record(status, notes, rowsUpdated = 0) {
  console.log(`[${SOURCE}] ${status}: ${notes}`);
  if (DRY || !sb) return;
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: rowsUpdated, notes: notes.slice(0, 500),
    });
  } catch { /* best-effort */ }
}

async function blind(reason) {
  // Do not advance scanned_to: the next run rescans this gap.
  let note = `BLIND: ${reason}`;
  const rows = await recentRows(24);
  const prevBlind = rows.slice(0, 2).filter((r) => (r.notes ?? "").startsWith("BLIND")).length;
  const pagedToday = rows.some((r) => (r.notes ?? "").includes("paged:blind"));
  if (prevBlind >= 2 && !pagedToday && !DRY && sb) {
    await pageOwner({ title: "Flood alarm cannot see Cloudflare", body: `Three runs in a row failed to read Cloudflare analytics (${reason}). Bot floods are not being watched until this is fixed.` });
    note += " paged:blind";
  }
  await record("error", note); // exit 0: the alarm is the page and the row, not a red badge
}

// ── main ─────────────────────────────────────────────────────────────────────
// No process.exit on the normal paths: on Windows it can abort while fetch
// sockets are still closing (libuv UV_HANDLE_CLOSING assertion).
async function main() {
  if (!TOKEN) return blind("CLOUDFLARE_CACHE_TOKEN not set");

  let scan;
  if (arg("from") || arg("to")) {
    const to = Date.parse(arg("to") ?? new Date().toISOString());
    scan = { from: Math.floor(Date.parse(arg("from") ?? new Date(to - 3600e3).toISOString()) / STEP_MS) * STEP_MS, to: Math.floor(to / STEP_MS) * STEP_MS };
  } else {
    let lastTo = null;
    if (sb) {
      const { data } = await sb.from("scraper_runs").select("notes").eq("source", SOURCE)
        .like("notes", "%scanned_to=%").order("finished_at", { ascending: false }).limit(1);
      lastTo = data?.[0]?.notes?.match(/scanned_to=(\S+)/)?.[1] ?? null;
    }
    scan = planScan(lastTo, Date.now());
  }
  const baseFrom = scan.from - 7 * 864e5;
  console.log(`scan ${new Date(scan.from).toISOString()} -> ${new Date(scan.to).toISOString()} (baseline from ${new Date(baseFrom).toISOString()})`);

  let det;
  try {
    det = detect(densify(await fetchBuckets(baseFrom, scan.to), baseFrom, scan.to), scan.from);
  } catch (e) {
    return blind(String(e.message ?? e).slice(0, 120));
  }
  const th = det.thresholds;
  const base = `scanned_to=${new Date(scan.to).toISOString()} · max ${fmt(det.maxBucket)}s/5min · ${fmt(det.scanSec)}s total · limits ${fmt(th.bucket)}/5min ${fmt(th.hour)}/h`;
  console.log(base);

  if (!det.bursts.length) {
    return record("success", `quiet · ${base}`, Math.round(det.maxBucket));
  }

  const bursts = [...det.bursts].sort((a, b) => b.sec - a.sec);
  const top = bursts[0];
  let detail;
  try {
    detail = await fetchDetail(top.start, top.end);
  } catch (e) {
    detail = null;
    console.log(`detail query failed: ${e.message}`);
  }
  const avgDaySec = det.avgDaySec;
  const body = detail
    ? alertText(top, detail, det, avgDaySec, bursts.slice(1, 4))
    : `${fmt(top.sec)} origin-seconds in ${hhmm(top.start)}-${hhmm(top.end)} UTC ${day(top.start)} (detail query failed).`;
  const title = `Bot flood: ${fmt(top.sec)}s of server time in ${Math.round((top.end - top.start) / 60000)} min`;
  console.log(`\n${title}\n${body}\n`);

  // Re-page only if nothing was paged in the last few hours, or this burst is
  // more than twice the last one paged. A sustained crawl pages again every few
  // hours; it does not page every run.
  const prior = (await recentRows(REPAGE_HOURS))
    .map((r) => Number((r.notes ?? "").match(/paged:flood peak=(\d+)/)?.[1]))
    .filter(Number.isFinite);
  const lastPeak = prior.length ? Math.max(...prior) : 0;
  let paged = "";
  if (DRY) paged = " [dry-run: would page]";
  else if (lastPeak && top.sec <= 2 * lastPeak) paged = ` suppressed (paged ${fmt(lastPeak)}s within ${REPAGE_HOURS}h)`;
  else if (sb) {
    const sent = await pageOwner({ title, body });
    console.log(`owner channels: ${JSON.stringify(sent)}`);
    paged = ` paged:flood peak=${Math.round(top.sec)}`;
  }
  await record("error",
    `FLOOD ${hhmm(top.start)}-${hhmm(top.end)} ${fmt(top.sec)}s`
    + (detail ? ` · ${fmt(detail.total)} req ${detail.ipCount} IPs max ${detail.maxPerIp}/IP · ${Math.round(detail.challenged * 100)}% challenged` : "")
    + ` · ${base}${paged}`, Math.round(det.maxBucket));
}

await main();
