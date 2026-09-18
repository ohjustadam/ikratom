#!/usr/bin/env node
/**
 * generate-state-of-play.mjs — print the LIVE half of STATE_OF_PLAY.md.
 *
 * STATE_OF_PLAY.md carries the durable facts: where the platform runs, what
 * bites you, where the plan is declared. Those change slowly and are worth
 * committing. What a session actually needs on top of that is the live layer —
 * which jobs ran, what has gone quiet, how far the migrations have moved —
 * and that changes hourly.
 *
 * So this prints rather than writes. Committing a generated status block
 * would mean a pull request per refresh, and pull-request churn on a repo
 * that batches merges is how the changelog went stale in the first place.
 *
 * READ-ONLY. It writes nothing, to disk or to the database — safe to run from
 * any session, including one that has no business mutating production.
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-state-of-play.mjs
 *   node --env-file=.env.local scripts/generate-state-of-play.mjs --json
 *   node scripts/generate-state-of-play.mjs --repo-only   # no DB needed
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY } from "./lib/cron-pager-registry.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const repoOnly = args.includes("--repo-only");

// ── repo facts (no network, no credentials) ────────────────────────────────
function countFiles(dir, match, recurse = true) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) n += recurse ? countFiles(p, match) : 0;
    else if (match.test(e.name)) n++;
  }
  return n;
}

const migrations = existsSync("supabase/migrations")
  ? readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort()
  : [];
const lastMigration = migrations[migrations.length - 1] ?? "(none)";
const nextMigration = String(
  Number((lastMigration.match(/^(\d{4})/) ?? [, "0"])[1]) + 1,
).padStart(4, "0");

const repo = {
  pages: countFiles("src/app", /^page\.tsx$/),
  migrations: migrations.length,
  last_migration: lastMigration,
  next_migration: nextMigration,
  scripts: countFiles("scripts", /\.mjs$/, false),
  workflows: countFiles(".github/workflows", /\.ya?ml$/, false),
  registered_sources: REGISTRY.length,
  box_only: REGISTRY.filter((e) => e.system === "local-box").map((e) => e.source),
};

// Flags held false are the declared-but-unshipped roadmap.
let flagsOff = [];
try {
  const cfg = readFileSync("src/config/site.config.ts", "utf8");
  flagsOff = [...cfg.matchAll(/^\s{4}(\w+):\s*false,/gm)].map((m) => m[1]);
} catch { /* optional */ }

// ── live facts (needs Supabase; degrades to repo-only) ─────────────────────
let live = null;
if (!repoOnly) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "No Supabase credentials in env — printing repo facts only.\n" +
        "  (run with --env-file=.env.local, or pass --repo-only to silence this)\n",
    );
  } else {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });

    const { data: latest, error } = await sb
      .from("scraper_runs_latest")
      .select("source, finished_at, status");
    if (error) {
      console.error(`Could not read scraper_runs_latest: ${error.message}`);
    } else {
      const seen = new Map();
      for (const r of latest ?? []) {
        if (r.source && r.finished_at) seen.set(r.source, r.finished_at);
      }
      const now = Date.now();
      const stale = [];
      const never = [];
      for (const e of REGISTRY) {
        const last = seen.get(e.source);
        if (!last) { never.push(e.source); continue; }
        const ageH = (now - new Date(last).getTime()) / 3_600_000;
        if (ageH > e.interval_hours * 3) {
          stale.push({ source: e.source, system: e.system, age_hours: Math.round(ageH) });
        }
      }
      stale.sort((a, b) => b.age_hours - a.age_hours);

      // Drafts waiting on a human at /admin/whats-new.
      let draftNotes = null;
      const { count, error: pnErr } = await sb
        .from("patch_notes")
        .select("slug", { count: "exact", head: true })
        .eq("status", "draft");
      if (!pnErr) draftNotes = count ?? 0;

      live = {
        sources_checked: REGISTRY.length,
        fresh: REGISTRY.length - stale.length - never.length,
        stale,
        never_observed: never,
        patch_note_drafts_waiting: draftNotes,
      };
    }
  }
}

const out = { generated_for: "STATE_OF_PLAY.md", repo, flags_off: flagsOff, live };

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log("── iKratom, live ──────────────────────────────────────────");
  console.log(`  pages ${repo.pages} · migrations ${repo.migrations} (next: ${repo.next_migration}) · scripts ${repo.scripts} · workflows ${repo.workflows}`);
  console.log(`  monitored job sources: ${repo.registered_sources}`);
  console.log(`  still box-only: ${repo.box_only.length ? repo.box_only.join(", ") : "none"}`);
  if (flagsOff.length) console.log(`  feature flags held off: ${flagsOff.join(", ")}`);
  if (!live) {
    console.log("\n  (no live telemetry — repo facts only)");
  } else {
    console.log(`\n  telemetry: ${live.fresh}/${live.sources_checked} sources fresh`);
    if (live.stale.length === 0) console.log("  nothing is stale.");
    else {
      console.log(`  ${live.stale.length} stale:`);
      for (const s of live.stale) console.log(`    ${s.source.padEnd(32)} ${s.age_hours}h  [${s.system}]`);
    }
    if (live.never_observed.length) {
      console.log(`  ${live.never_observed.length} never observed: ${live.never_observed.join(", ")}`);
    }
    if (live.patch_note_drafts_waiting) {
      console.log(`\n  ${live.patch_note_drafts_waiting} patch-note draft(s) waiting at /admin/whats-new`);
    }
  }
  console.log("\n  Durable facts live in STATE_OF_PLAY.md — update it when one changes.");
}
