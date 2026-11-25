#!/usr/bin/env node
/**
 * crawl-brake.mjs — the hourly tripwire for the staged crawl lift.
 *
 * WHY (2026-11-24). robots.txt is lifted in stages (src/lib/crawl-policy.ts,
 * `site_config.crawl_stage`). Googlebot and Bingbot skip every Cloudflare rule,
 * so once a family is open the only brake is on our side. Each hour this job
 * reads the host's usage meter (Netlify's TRUE credit meter today) and, if a stage is open and the month is
 * past 90% or a recent day spiked far above the median (thresholds and tests:
 * scripts/lib/crawl-brake.mjs), it sets the stage back to 0 and pages the owner.
 *
 * It only ever LOWERS the stage. Raising is a human act (scripts/crawl-stage.mjs).
 * It is idle at stage 0: no credit read, one cheap database read.
 *
 * Google caches robots.txt for about a day, so this slows the crawl by the next
 * morning, not this minute. The page tells the owner how to cut it at once with
 * the Cloudflare lever. Runbook: docs/RUNBOOK_crawl_lift.md.
 *
 *   node --env-file=.env.local scripts/crawl-brake.mjs            # live
 *   node --env-file=.env.local scripts/crawl-brake.mjs --dry-run  # read-only, no write, no page
 *
 * Telemetry source: crawl_brake. A row every run. status "error" means BRAKED,
 * BRAKE FAILED or BLIND (same convention as flood_alarm), not that it crashed.
 */
import { createClient } from "@supabase/supabase-js";
import { readUsageMeter } from "./lib/usage-meter.mjs";
import { evaluateBrake } from "./lib/crawl-brake.mjs";
import { alertOwner } from "./lib/owner-alert.mjs";

const DRY = process.argv.includes("--dry-run");
const SOURCE = "crawl_brake";
const t0 = new Date();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

async function record(status, notes) {
  console.log(`[${SOURCE}] ${status}: ${notes}`);
  if (DRY) return;
  try {
    await sb.from("scraper_runs").insert({
      source: SOURCE, started_at: t0.toISOString(), finished_at: new Date().toISOString(),
      status, rows_updated: 0, notes: notes.slice(0, 500),
    });
  } catch { /* best-effort */ }
}

async function recentBlind() {
  const { data } = await sb.from("scraper_runs").select("notes")
    .eq("source", SOURCE).order("finished_at", { ascending: false }).limit(3);
  return (data ?? []).length === 3 && data.every((r) => String(r.notes ?? "").startsWith("BLIND"));
}

async function main() {
  const { data: cfg, error } = await sb.from("site_config").select("crawl_stage").eq("id", true).maybeSingle();
  if (error) {
    // Migration 0332 not applied yet, or the read failed: the site reads stage 0 either way.
    await record("ok", `no stage to brake (read: ${error.message.slice(0, 80)})`);
    return;
  }
  const stage = Number(cfg?.crawl_stage ?? 0);
  const truth = stage ? await readUsageMeter() : null; // host-neutral: scripts/lib/usage-meter.mjs
  const ev = evaluateBrake({ stage, truth });

  if (ev.blind) {
    // An alarm with no eyes must say so, but not every hour: page on the third blind run in a row.
    const third = !DRY && (await recentBlind());
    await record("error", `${ev.note} (stage ${stage} is open)${third ? " paged:blind" : ""}`);
    if (third) {
      await alertOwner({
        sb, priority: "high", tags: ["warning"],
        title: "Crawl brake cannot read the credit meter",
        body: `Stage ${stage} of the crawl lift is open and the brake has been blind for three runs (${ev.note}). `
          + "It cannot stop the lift if credits run away. Lower it by hand with: node --env-file=.env.local scripts/crawl-stage.mjs set 0 --yes",
      });
    }
    return;
  }

  if (!ev.brake) { await record("ok", ev.note); return; }

  // Brake: stage -> 0, then read it back. A silent zero-row update (RLS) must not read as success.
  let failed = null;
  if (!DRY) {
    const { data: rows, error: werr } = await sb.from("site_config").update({ crawl_stage: 0 }).eq("id", true).select("crawl_stage");
    if (werr) failed = werr.message;
    else if (!rows?.length || Number(rows[0].crawl_stage) !== 0) failed = "update touched no row";
  }
  const lever = "To cut Googlebot and Bingbot off at once (robots.txt is cached by them for about a day): "
    + "node --env-file=.env.local private/scripts/cf-bot-brake.mjs --apply";
  const title = failed ? "Crawl brake FAILED to lower the stage" : `Crawl lift stopped at stage ${stage}`;
  const body = `${ev.reasons.join("; ")}. `
    + (failed ? `The write failed (${failed}): lower it by hand with node --env-file=.env.local scripts/crawl-stage.mjs set 0 --yes. `
              : `site_config.crawl_stage is now 0; robots.txt and the sitemap follow within the hour. `)
    + lever;
  let sent = "";
  if (DRY) sent = " [dry-run: would page]";
  else {
    const out = await alertOwner({ sb, title, body, priority: "urgent", tags: ["rotating_light"], link: "https://www.ikratom.org/admin/ops" });
    sent = ` paged:${JSON.stringify(out)}`;
  }
  await record("error", `${failed ? "BRAKE FAILED" : "BRAKED"} stage ${stage}->0: ${ev.reasons.join("; ")}${sent}`);
}

await main();
