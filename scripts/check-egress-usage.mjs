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
 * Billing month anchor: the org was created 2026-07-16, so the cycle resets
 * the 16th of each month (adjust EGRESS_CYCLE_ANCHOR_DAY if Supabase billing
 * says otherwise).
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
const THRESHOLDS = [0.5, 0.75, 0.9]; // page at 50%, 75%, 90%
const EGRESS_CYCLE_ANCHOR_DAY = 16;  // org created 2026-07-16

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
// If this is the very first reading of the cycle, use the counter itself as a
// conservative (over-counting) estimate — better a false early warning than none.
if (readings.length === 0) mtdBytes = currentBytes;

const pct = mtdBytes / (BUDGET_GB * 1e9);
console.log(`month-to-date estimate: ${(mtdBytes / 1e9).toFixed(3)} GB of ${BUDGET_GB} GB (${(pct * 100).toFixed(1)}%) · cycle since ${cycleStart().toISOString().slice(0, 10)}`);

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
          body: `${(mtdBytes / 1e9).toFixed(2)} GB of ${BUDGET_GB} GB this cycle. At 100% the project gets RESTRICTED (the 2026-07-16 incident). Check caching + cron volume.`,
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
      notes: `MTD ~${(mtdBytes / 1e9).toFixed(2)}GB/${BUDGET_GB}GB (${(pct * 100).toFixed(1)}%)${pagedNote}`,
    });
  } catch { /* best-effort */ }
}
console.log("Done.");
