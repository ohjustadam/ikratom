#!/usr/bin/env node
/**
 * check-cron-staleness.mjs
 *
 * Self-monitoring observability layer. Runs every 30 min via
 * cron-hourly.yml. Compares the cron registry (defined inline below,
 * mirroring src/lib/cron-registry.ts) against actual scraper_runs.
 * For any source past 3x expected interval, sends a web-push alert
 * to the owner — but ONLY ONCE per silent period, tracked via the
 * cron_staleness_alerts state table (migration 0161).
 *
 * When a previously-silent source recovers, the row is deleted +
 * a "recovered" line is added to admin_audit_log.
 *
 * The script itself ALSO writes to scraper_runs so it self-monitors
 * (if check-cron-staleness goes silent, it can't fire its own alert,
 * but it'll show up in /admin/automation as silent on the next view).
 *
 * Usage:
 *   node --env-file=.env.local scripts/check-cron-staleness.mjs
 *   node --env-file=.env.local scripts/check-cron-staleness.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
// Canonical source list — extracted module so tests can assert every entry
// has a real scraper_runs writer (kills the phantom-source class for good).
import { REGISTRY } from "./lib/cron-pager-registry.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const t0 = Date.now();
console.log(`Checking ${REGISTRY.length} cron sources for staleness…`);

// 1. Pull latest-run per source from scraper_runs_latest view
const { data: latestRows, error: latestErr } = await sb
  .from("scraper_runs_latest")
  .select("source, finished_at, status");
if (latestErr) {
  console.error("Couldn't read scraper_runs_latest:", latestErr.message);
  process.exit(1);
}
const latestBySource = new Map();
for (const r of latestRows ?? []) {
  if (r.source && r.finished_at) latestBySource.set(r.source, r.finished_at);
}

// 2. Pull current silent-state rows so we know what's already alerted
const { data: alertedRows } = await sb
  .from("cron_staleness_alerts")
  .select("source, alerted_at");
const alertedSources = new Set((alertedRows ?? []).map((r) => r.source));

// 3. For each registry entry, decide: silent, recovered, or quiet-OK
const now = Date.now();
const newlySilent = []; // not previously alerted, just went silent
const recovered = [];   // was alerted, has now run again
const stillSilent = []; // alerted + still silent (no new push, just status)

const neverRun = []; // sources that have never written a row — skipped (grace period)
for (const entry of REGISTRY) {
  const last = latestBySource.get(entry.source);

  // GRACE: a source that has NEVER written telemetry isn't "silent" —
  // it's "not yet observed". Could mean the script writes telemetry
  // under a different source name, or the cron hasn't fired its first
  // post-deploy run yet. Don't push alerts for these — admin can spot
  // them manually in /admin/automation under "untracked".
  if (!last) {
    neverRun.push(entry.source);
    continue;
  }

  const ageMs = now - new Date(last).getTime();
  const silentThresholdMs = entry.interval_hours * 3 * 3_600_000;
  const isSilent = ageMs > silentThresholdMs;
  const wasAlerted = alertedSources.has(entry.source);

  if (isSilent && !wasAlerted) newlySilent.push({ ...entry, last_seen_at: last, age_hours: Math.round(ageMs / 3_600_000) });
  else if (!isSilent && wasAlerted) recovered.push({ ...entry, last_seen_at: last });
  else if (isSilent && wasAlerted) stillSilent.push({ ...entry, last_seen_at: last });
}
if (neverRun.length > 0) {
  console.log(`  ${neverRun.length} sources have never written telemetry: ${neverRun.join(", ")}`);
  // ESCALATION (2026-07-16 audit): a perpetual grace-skip is how dead-from-birth
  // automations stayed invisible. Alert ONCE per never-observed source (dedup'd
  // via cron_staleness_alerts like ordinary silences; clears automatically when
  // the source writes its first row and the "recovered" path deletes the row).
  for (const source of neverRun) {
    if (!alertedSources.has(source)) {
      const entry = REGISTRY.find((r) => r.source === source);
      newlySilent.push({
        ...entry,
        last_seen_at: null,
        age_hours: -1, // sentinel: never observed
      });
    }
  }
}

console.log(`  ${newlySilent.length} newly silent · ${recovered.length} recovered · ${stillSilent.length} still silent`);

// 4. For newly-silent: insert row, push owner
if (newlySilent.length > 0 && !DRY) {
  await sb.from("cron_staleness_alerts").upsert(
    newlySilent.map((s) => ({
      source: s.source,
      last_seen_at: s.last_seen_at,
      alerted_at: new Date().toISOString(),
      system: s.system,
      cadence: s.cadence,
    })),
    { onConflict: "source" },
  );

  // Push to owner. Find owner profile + their push subscriptions.
  const { data: ownerProfile } = await sb
    .from("profiles")
    .select("id")
    .eq("is_owner", true)
    .maybeSingle();
  if (ownerProfile) {
    const { data: subs } = await sb
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", ownerProfile.id);
    if (subs && subs.length > 0) {
      const sourceList = newlySilent.slice(0, 5).map((s) => s.source).join(", ");
      const more = newlySilent.length > 5 ? ` +${newlySilent.length - 5} more` : "";
      const payload = {
        title: `⚠ ${newlySilent.length} cron source${newlySilent.length === 1 ? "" : "s"} silent`,
        body: `${sourceList}${more}`,
        link: "/admin/automation",
        tag: "cron-staleness",
      };
      // VAPID may not be configured in every CI context. Skip the push
      // (don't crash the whole job) — the staleness row was already
      // written, so the admin will still see it on /admin/automation.
      // Accept either env name. The rest of the platform uses the NEXT_PUBLIC_
      // prefixed key (fire-daily-brief-push, send.ts, etc.); this script had
      // read the bare VAPID_PUBLIC_KEY, so if only the prefixed secret existed
      // the owner staleness-alert push silently no-op'd every run — defeating
      // the entire self-monitoring layer. Fall back so it works either way.
      const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
      if (!vapidPublic || !process.env.VAPID_PRIVATE_KEY) {
        console.log("  (VAPID not configured in this env — push skipped; row still recorded)");
      } else {
        const require = createRequire(import.meta.url);
        const webpush = require("web-push");
        webpush.setVapidDetails(
          process.env.VAPID_SUBJECT || "mailto:support@ikratom.org",
          vapidPublic,
          process.env.VAPID_PRIVATE_KEY,
        );
        let pushedCount = 0;
        for (const s of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(payload),
              { TTL: 60 * 60 * 6 },
            );
            pushedCount++;
          } catch (e) {
            console.log(`  push failed for one endpoint: ${e.message?.slice(0, 60)}`);
          }
        }
        console.log(`  Pushed staleness alert to owner via ${pushedCount}/${subs.length} subscription(s)`);
      }
    } else {
      console.log("  (no push subscriptions for owner — push skipped; row was still recorded)");
    }
  } else {
    console.log("  (no owner profile found — push skipped)");
  }
}

// 5. For recovered: delete row + audit-log
if (recovered.length > 0 && !DRY) {
  await sb.from("cron_staleness_alerts").delete().in("source", recovered.map((r) => r.source));
  for (const r of recovered) {
    try {
      await sb.from("admin_audit_log").insert({
        actor_id: null,
        action: "cron_staleness_recovered",
        target_type: "user",
        target_id: null,
        details: { source: r.source, system: r.system, recovered_at: r.last_seen_at },
      });
    } catch { /* admin_audit_log shape may differ; non-fatal */ }
  }
  console.log(`  Cleared ${recovered.length} recovered source(s)`);
}

if (DRY) {
  console.log("DRY RUN — first 10 newly-silent sources:");
  for (const s of newlySilent.slice(0, 10)) {
    console.log(` ${s.source.padEnd(36)} silent ${s.age_hours}h (expected ≤${s.interval_hours}h)`);
  }
}

// 6. Self-monitor: record our own run in scraper_runs
try {
  await sb.from("scraper_runs").insert({
    source: "check_cron_staleness",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: newlySilent.length + recovered.length,
    notes: `${newlySilent.length} new alerts · ${recovered.length} recovered · ${stillSilent.length} still silent`,
  });
} catch { /* best-effort */ }

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s.`);
