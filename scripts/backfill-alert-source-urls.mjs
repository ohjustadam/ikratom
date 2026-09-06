#!/usr/bin/env node
/**
 * backfill-alert-source-urls.mjs — close the loop between the hourly classifier
 * and the daily URL resolver.
 *
 * THE GAP (diagnosed 2026-09-05). `scripts/lib/source-url.mjs` documents it
 * exactly: news arrives as a Google-News redirect, `resolve-news-urls.mjs`
 * turns that into a real publisher URL in the DAILY cron, but
 * `classify-news-policy.mjs` mints the alert HOURLY — so at classify time
 * `resolved_url` is usually still null and the alert is written with
 * `source_url: null`. Nothing ever went back to fill it in, so the null was
 * permanent.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. `auto-approve-campaigns.mjs` requires a
 * source URL before it will auto-approve (require_source). With the field
 * permanently null, campaigns could never clear that gate: every run reported
 * approve=0/1, reject=0, **escalate=17-18** — the same items escalating forever.
 * From the outside that reads as "auto-resolve denies everything", but it never
 * rejected anything; it refused to decide, because the evidence it needed was
 * missing rather than absent-by-judgement.
 *
 * Measured before this ran: 1,238 of 5,681 alerts (22%) had no source_url, and
 * 90% of a 60-item sample had a linked news_item whose resolved_url was already
 * populated. The data was there the whole time.
 *
 * Never invents a citation: it only copies a URL that is already stored against
 * the linked news item, and only through bestSourceUrl(), so a Google redirect
 * is still rejected rather than pasted into something an official will read.
 *
 *   node --env-file=.env.local scripts/backfill-alert-source-urls.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-alert-source-urls.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { bestSourceUrl } from "./lib/source-url.mjs";

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = args.includes("--dry-run");
const LIMIT = parseInt(arg("--limit") ?? "1500", 10);

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const t0 = Date.now();

// Alerts missing a citation. Narrow column list on purpose — this table is the
// project's largest by row payload and a select("*") here was 39% of the whole
// Supabase egress budget in a sibling script.
const { data: alerts, error } = await sb
  .from("policy_alerts")
  .select("id, title")
  .is("source_url", null)
  .order("created_at", { ascending: false })
  .limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }
console.log(`${alerts.length} alert(s) with no source_url${DRY ? " [DRY]" : ""}`);

// Pull the linked news items in ONE batched query per chunk rather than one
// request per alert — the N+1 pattern that made promote-alert-to-bill the
// single largest egress consumer on the project.
const CHUNK = 200;
let fixed = 0, unresolvable = 0, noNews = 0;

for (let i = 0; i < alerts.length; i += CHUNK) {
  const batch = alerts.slice(i, i + CHUNK);
  const ids = batch.map((a) => a.id);
  const { data: news } = await sb
    .from("news_items")
    .select("policy_alert_id, resolved_url, url")
    .in("policy_alert_id", ids);

  const byAlert = new Map();
  for (const n of news ?? []) {
    // Several news items can share an alert (duplicates across outlets); keep
    // the first that yields a citation-safe URL.
    if (!byAlert.has(n.policy_alert_id)) byAlert.set(n.policy_alert_id, n);
    else if (!bestSourceUrl(byAlert.get(n.policy_alert_id).resolved_url) && n.resolved_url) {
      byAlert.set(n.policy_alert_id, n);
    }
  }

  const updates = [];
  for (const a of batch) {
    const n = byAlert.get(a.id);
    if (!n) { noNews++; continue; }
    const url = bestSourceUrl(n.resolved_url, n.url);
    if (!url) { unresolvable++; continue; }
    updates.push({ id: a.id, url });
  }

  for (const u of updates) {
    if (DRY) { fixed++; continue; }
    const { error: upErr } = await sb.from("policy_alerts").update({ source_url: u.url }).eq("id", u.id);
    if (upErr) console.log(`  ⚠ ${u.id.slice(0, 8)} ${upErr.message.slice(0, 60)}`);
    else fixed++;
  }
  console.log(`  batch ${i / CHUNK + 1}: +${updates.length} (running total ${fixed})`);
}

console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s — repaired ${fixed}, ` +
  `${unresolvable} had only a Google redirect, ${noNews} had no linked news item.`);

if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "backfill_alert_source_urls",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: fixed > 0 ? "success" : "empty",
      rows_updated: fixed,
      notes: `repaired ${fixed}, ${unresolvable} redirect-only, ${noNews} no news item`,
    });
  } catch { /* best-effort */ }
}
