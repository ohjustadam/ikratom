#!/usr/bin/env node
/**
 * check-egress-usage.mjs — the "never restricted again" failsafe.
 *
 * Born from the 2026-07-16 incident: the free-tier 5GB/mo egress cap was blown
 * with ZERO warning because nothing watched the meter — the platform found out
 * when Supabase turned the project off. This watchdog reads the project's
 * Prometheus metrics endpoint (available on every plan) and pages the owner at
 * 50% / 75% / 90% of the monthly budget, weeks before a restriction.
 *
 * Signal: node_network_transmit_bytes_total (DB node, device ens5) — a raw
 * network counter, so it slightly OVER-counts billable egress (replication +
 * infra chatter). Over-counting is the safe direction for an early-warning
 * system. The counter resets on instance restart; we handle that by storing
 * each run's reading in scraper_runs and summing positive deltas across the
 * billing month (a reset shows up as reading < previous → treat the new
 * reading itself as the delta).
 *
 * Billing month anchor: the 18th — read off the dashboard, not inferred. See
 * EGRESS_CYCLE_ANCHOR_DAY below for why that distinction cost us a false alarm.
 *
 * This ALSO watches database size, which egress alone never covered. Egress
 * resets every cycle; the database only grows, so it is the ceiling that
 * actually arrives. On 2026-09-24 it sat at 0.32 of 0.5 GB (65%) with nothing
 * in the repo watching it.
 *
 * Runs daily via cron-daily.yml. Telemetry source: egress_watchdog (the notes
 * field carries the month-to-date estimate so /admin/automation shows it).
 *
 * Usage: node --env-file=.env.local scripts/check-egress-usage.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const DRY = process.argv.includes("--dry-run");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Derive the project ref from the URL host — CI doesn't carry a separate
// SUPABASE_PROJECT_REF secret, and one less secret means one less rotation.
const REF = process.env.SUPABASE_PROJECT_REF || (URL ? new globalThis.URL(URL).host.split(".")[0] : null);
if (!REF || !KEY || !URL) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const BUDGET_GB = 5;

/**
 * Correction factor: raw NIC counter -> billable egress.
 *
 * CALIBRATED 2026-09-05 against the Supabase dashboard, which is the only place
 * the billable figure exists (the Management API exposes no usage endpoint —
 * verified). At the same moment this watchdog computed 8.05 GB, the dashboard
 * read **4.352 / 5 GB (87%)**. Ratio 4.352/8.05 = 0.54.
 *
 * The gap is what the header comment always said it would be: replication and
 * infra chatter ride on node_network_transmit_bytes_total but are not billed.
 * Uncorrected, the watchdog reported 161% while the account was at 87% — a
 * false alarm big enough to be ignored, which is the same failure that made the
 * Netlify credit floor untrustworthy. Over-reporting is not "safe" if it
 * trains you to discount the alarm.
 *
 * RE-CALIBRATE by reading Usage in the Supabase dashboard (org ikratom-2) and
 * setting this to dashboardGB / thisWatchdogsGB on the same day.
 */
// RE-CALIBRATED 2026-09-10. At 0.54 this watchdog computed 5.116 GB (102.3%)
// while the dashboard read 4.71 GB (94.2%) — it was calling a breach that had
// not happened, on a day the site was serving fine. 4.71/5.116 = 0.921, so
// 0.54 x 0.921 = 0.497.
//
// Over-reporting is not the "safe" direction, and this codebase has learned
// that twice already: the pre-calibration version cried 161% at 87% and got
// discounted, and the Netlify credit floor went the same way. A watchdog you
// have to mentally derate is a watchdog you eventually ignore — and this one
// now also drives the load-shedding gate, so reading high means deferring real
// work for no reason.
const BILLABLE_RATIO = 0.497;
const THRESHOLDS = [0.5, 0.75, 0.9]; // page at 50%, 75%, 90%
/**
 * VERIFIED AGAINST THE DASHBOARD 2026-09-24, which read "18 Sep 2026 - 18 Oct
 * 2026". This was 16, inferred from the org's creation date rather than from
 * billing, and being two days early made every month-to-date sum count two
 * extra days of traffic. The damage was not academic: on 2026-09-24 this script
 * reported 1.477 GB (29.5%) and projected a breach on ~Oct 11, while the
 * dashboard showed 1.023 GB (20%) with no risk at all. Summing only from the
 * 18th lands at ~1.13 GB — about 10% high, which is the deliberate over-report
 * margin BILLABLE_RATIO already carries.
 *
 * So: the anchor was the defect, NOT the ratio. Do not "fix" the ratio to chase
 * the remaining gap without re-measuring against the dashboard first.
 */
const EGRESS_CYCLE_ANCHOR_DAY = 18;

// Current billing-cycle start (the most recent anchor day, UTC).
function cycleStart(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), EGRESS_CYCLE_ANCHOR_DAY));
  if (now < d) d.setUTCMonth(d.getUTCMonth() - 1);
  return d;
}

// 1. Read the current transmit counter from the metrics endpoint.
const metricsRes = await fetch(`https://${REF}.supabase.co/customer/v1/privileged/metrics`, {
  headers: { Authorization: "Basic " + Buffer.from(`service_role:${KEY}`).toString("base64") },
});
if (!metricsRes.ok) {
  console.error(`metrics endpoint ${metricsRes.status} — cannot read egress counter`);
  try {
    await sb.from("scraper_runs").insert({
      source: "egress_watchdog", started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status: "error", notes: `metrics endpoint ${metricsRes.status}`,
    });
  } catch { /* best-effort */ }
  process.exit(1);
}
const text = await metricsRes.text();
let currentBytes = 0;
for (const line of text.split("\n")) {
  if (line.startsWith("node_network_transmit_bytes_total") && line.includes('service_type="db"')) {
    currentBytes += parseFloat(line.trim().split(/\s+/).pop()) || 0;
  }
}
console.log(`current transmit counter: ${(currentBytes / 1e9).toFixed(3)} GB (since instance start)`);

/**
 * DATABASE SIZE — the ceiling that does not reset.
 *
 * Egress is forgiven every billing cycle; disk is not. The free tier allows
 * 0.5 GB and hitting it stops writes, which takes the pipelines down without
 * any of the egress warnings ever firing. Nothing in this repo watched it until
 * 2026-09-24, when a dashboard check found it at 65% — the closest ceiling we
 * had, and completely unmonitored. The same metrics payload we already fetched
 * carries it, so this costs nothing extra.
 */
const DB_BUDGET_BYTES = 0.5e9;
let dbBytes = 0;
for (const line of text.split("\n")) {
  if (line.startsWith("pg_database_size_bytes") && line.includes('datname="postgres"')) {
    dbBytes = parseFloat(line.trim().split(/\s+/).pop()) || 0;
    break;
  }
}
const dbPct = dbBytes / DB_BUDGET_BYTES;
const dbNote = dbBytes > 0 ? ` · db ${(dbBytes / 1e9).toFixed(3)}/0.5GB (${(dbPct * 100).toFixed(0)}%)` : "";
if (dbBytes > 0) {
  console.log(`database size: ${(dbBytes / 1e9).toFixed(3)} GB of 0.5 GB (${(dbPct * 100).toFixed(1)}%)`);
  if (dbPct >= 0.8) {
    console.log(`⚠ DATABASE at ${(dbPct * 100).toFixed(0)}% of the free-tier cap. This does NOT reset`);
    console.log(`  monthly like egress — at 100% writes stop. Biggest table is usually news_items;`);
    console.log(`  prune old rows or archive before it lands.`);
  }
}

// 2. Month-to-date = sum of positive deltas across this cycle's daily readings.
const { data: prior } = await sb
  .from("scraper_runs")
  .select("finished_at, rows_updated, notes")
  .eq("source", "egress_watchdog")
  .gte("finished_at", cycleStart().toISOString())
  .order("finished_at", { ascending: true })
  .limit(200);
// rows_updated stores the raw counter reading in MB (int column).
const readings = (prior ?? []).map((r) => (r.rows_updated ?? 0) * 1e6).filter((v) => v > 0);
let mtdBytes = 0;
let prev = null;
for (const v of [...readings, currentBytes]) {
  if (prev !== null) mtdBytes += v >= prev ? v - prev : v; // reset → count the new reading itself
  else mtdBytes += 0; // first reading of the cycle anchors the baseline
  prev = v;
}
/**
 * FIRST READING OF A NEW CYCLE (fixed 2026-09-16, after it fired).
 *
 * This used to say `if (readings.length === 0) mtdBytes = currentBytes`, on the
 * reasoning that a conservative over-count beats no warning. It does not, and
 * the arithmetic is worse than "conservative": the counter is cumulative since
 * INSTANCE START, not since the cycle start, so the first reading of a cycle
 * reported the instance's entire lifetime as this month's usage.
 *
 * On 2026-09-16 — the morning the cycle reset — it read 12.59 GB against a 5 GB
 * cap, called it 251.8%, and pushed the owner a "project about to be
 * RESTRICTED" alert. Real usage at that moment was 0.019 GB. That is not an
 * early warning, it is a guaranteed false alarm on day one of EVERY cycle, and
 * the cost of it is specific: this is the one alarm that must be believed, and
 * nothing teaches someone to swipe an alert away faster than it being wrong
 * every month on a schedule.
 *
 * The counter reading taken just BEFORE the cycle boundary is, to within a few
 * hours, the counter's value AT the boundary — so the difference is this
 * cycle's usage. The watchdog runs daily, so that reading essentially always
 * exists. When it genuinely does not (first ever run, or a gap across the
 * boundary), we cannot know the split, and saying so is better than inventing
 * a number in either direction: anchor the baseline, report ~0, and let
 * tomorrow's delta be the first real measurement.
 */
let baselineNote = "";
if (readings.length === 0) {
  const { data: preCycle } = await sb
    .from("scraper_runs")
    .select("finished_at, rows_updated")
    .eq("source", "egress_watchdog")
    .lt("finished_at", cycleStart().toISOString())
    .order("finished_at", { ascending: false })
    .limit(1);
  const anchorBytes = (preCycle?.[0]?.rows_updated ?? 0) * 1e6;
  if (anchorBytes > 0 && currentBytes >= anchorBytes) {
    mtdBytes = currentBytes - anchorBytes;
    baselineNote = ` · anchored to the ${String(preCycle[0].finished_at).slice(0, 10)} reading`;
  } else {
    // No usable anchor — either no prior reading, or the instance restarted and
    // reset the counter. Both mean this cycle's usage is unknown, not huge.
    mtdBytes = 0;
    baselineNote = anchorBytes > 0
      ? " · counter reset since last reading — baseline re-anchored, MTD unknown until tomorrow"
      : " · no pre-cycle reading — baseline anchored, MTD unknown until tomorrow";
    console.log(`⚠ first reading of this cycle with no usable anchor${baselineNote}`);
  }
}

const billableBytes = mtdBytes * BILLABLE_RATIO;
const pct = billableBytes / (BUDGET_GB * 1e9);
console.log(`month-to-date billable estimate: ${(billableBytes / 1e9).toFixed(3)} GB of ${BUDGET_GB} GB (${(pct * 100).toFixed(1)}%) · cycle since ${cycleStart().toISOString().slice(0, 10)}${baselineNote}`);

// PROJECTION. A percentage answers "how bad is it"; only a DATE answers "how
// long have I got". On 2026-09-07 this read 94.3% with 8 days still to run —
// alarming, but the number that actually matters is that the cap lands in
// about two days. Rate is taken from the last ~3 days of readings, not the
// cycle average, so a fix that lands mid-cycle is reflected instead of being
// buried under the pre-fix days.
function projectBreach() {
  const pts = (prior ?? [])
    .map((r) => ({ t: new Date(r.finished_at).getTime(), mb: Number(r.rows_updated ?? 0) }))
    .filter((p) => p.mb > 0);
  pts.push({ t: Date.now(), mb: currentBytes / 1e6 });
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const cutoff = last.t - 3 * 864e5;
  const first = pts.find((p) => p.t >= cutoff) ?? pts[0];
  const elapsedDays = (last.t - first.t) / 864e5;
  if (elapsedDays <= 0.5) return null; // too little history to extrapolate
  const billableMbPerDay = ((last.mb - first.mb) / elapsedDays) * BILLABLE_RATIO;
  if (billableMbPerDay <= 0) return null;
  const capMb = BUDGET_GB * 1000;
  const usedMb = billableBytes / 1e6;
  const next = new Date(cycleStart());
  next.setUTCMonth(next.getUTCMonth() + 1);
  const daysToReset = (next.getTime() - last.t) / 864e5;
  return {
    rate: billableMbPerDay,
    daysToReset,
    projectedMb: usedMb + billableMbPerDay * daysToReset,
    daysToBreach: (capMb - usedMb) / billableMbPerDay,
    safeRate: Math.max(0, (capMb - usedMb) / Math.max(daysToReset, 0.1)),
    resetOn: next.toISOString().slice(0, 10),
  };
}
const proj = projectBreach();
if (proj) {
  console.log(`  rate (last ~3d): ${proj.rate.toFixed(0)} MB/day billable · sustainable is ${(BUDGET_GB * 1000 / 30).toFixed(0)}`);
  console.log(`  projected at reset (${proj.resetOn}): ${proj.projectedMb.toFixed(0)} MB (${((proj.projectedMb / (BUDGET_GB * 1000)) * 100).toFixed(0)}% of cap)`);
  if (proj.daysToBreach < proj.daysToReset) {
    const on = new Date(Date.now() + proj.daysToBreach * 864e5).toISOString().slice(0, 10);
    console.log(`  ⚠ BREACHES the cap on ~${on} (${proj.daysToBreach.toFixed(1)} days) — before the reset.`);
    console.log(`     staying under needs ≤ ${proj.safeRate.toFixed(0)} MB/day billable from here.`);
  }
}

// 3. Threshold paging — once per threshold per cycle (dedupe via notes history).
const crossed = THRESHOLDS.filter((t) => pct >= t);
const already = new Set((prior ?? []).flatMap((r) => (r.notes?.match(/paged@(\d+)%/g) ?? []).map((m) => m.replace("paged@", "").replace("%", ""))));
const toPage = crossed.filter((t) => !already.has(String(t * 100)));
let pagedNote = "";
if (toPage.length > 0) {
  const top = Math.max(...toPage);
  pagedNote = ` paged@${top * 100}%`;
  console.log(`⚠ crossing ${top * 100}% of monthly egress budget — paging owner`);
  if (!DRY) {
    const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).maybeSingle();
    if (owner) {
      const { data: subs } = await sb.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", owner.id);
      const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
      if (subs?.length && pub && priv) {
        const require = createRequire(import.meta.url);
        const webpush = require("web-push");
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@ikratom.org", pub, priv);
        const payload = JSON.stringify({
          title: `📊 Supabase egress at ${(pct * 100).toFixed(0)}% of free tier`,
          body: `${(billableBytes / 1e9).toFixed(2)} GB of ${BUDGET_GB} GB this cycle`
            + (proj && proj.daysToBreach < proj.daysToReset
              ? ` — on track to hit the cap in ~${proj.daysToBreach.toFixed(0)} day(s), before the ${proj.resetOn} reset. Needs ≤${proj.safeRate.toFixed(0)} MB/day to stay under.`
              : `.`)
            + ` At 100% the project gets RESTRICTED (the 2026-07-16 incident).`,
          link: "/admin/automation", tag: "egress-watchdog",
        });
        for (const s of subs) {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 }); } catch { /* per-sub best-effort */ }
        }
      }
    }
  }
}

// 4. Telemetry — the reading itself (MB in rows_updated) + MTD estimate in notes.
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "egress_watchdog",
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      status: pct >= 0.9 ? "error" : "success",
      rows_updated: Math.round(currentBytes / 1e6),
      notes: `MTD ~${(billableBytes / 1e9).toFixed(2)}GB/${BUDGET_GB}GB (${(pct * 100).toFixed(1)}%)${dbNote}${baselineNote}${pagedNote}`,
    });
  } catch { /* best-effort */ }
}
console.log("Done.");
