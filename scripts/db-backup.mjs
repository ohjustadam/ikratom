#!/usr/bin/env node
/**
 * db-backup.mjs — encrypted database backups, sized to fit the egress budget.
 *
 * WHY (2026-10-03): Supabase Free keeps NO backups (the backups API returns 0)
 * and nothing in this repo dumped the database, so losing the project meant
 * losing every account, campaign, send record and forum post for good.
 *
 * WHY TWO MODES: a pg_dump is database egress, and egress has a hard 5 GB/month
 * cap that already restricted the project once. The tables total ~220 MB, so a
 * daily full dump would cost ~6.6 GB/month on its own.
 *   core  (daily)  — everything people made or curated by hand: accounts and
 *                    login identities, campaigns' actions, forum, DMs, meetings,
 *                    settings, audit log. A few MB. Bulky tables that the crons
 *                    rebuild from public sources keep their SCHEMA, not data.
 *   full  (weekly) — everything except logs and caches. ~200 MB. Skipped (and
 *                    retried next run) when the egress budget is tight.
 *
 * Output: <out>/ikratom-<mode>-<YYYY-MM-DD>-{public,auth}.sql.gz.enc, sealed with
 * scripts/backup-public-key.pem (see lib/backup-crypto.mjs). Only the owner's
 * private key opens them, so storing them as GitHub artifacts is safe.
 *
 *   SUPABASE_DB_URL=postgres://... node scripts/db-backup.mjs --mode core --out backup-out
 *   node scripts/db-backup.mjs --mode full --dry-run      # print the plan only
 *
 * Needs pg_dump >= the server's major version (17) and SUPABASE_DB_URL pointing
 * at the SESSION pooler (port 5432) — GitHub runners have no IPv6, and the
 * direct db.<ref>.supabase.co host is IPv6-only on the free plan.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encryptStream } from "./lib/backup-crypto.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MODE = arg("mode", "core");
const OUT = arg("out", "backup-out");
const DRY = argv.includes("--dry-run");
const here = path.dirname(fileURLToPath(import.meta.url));

// Rebuilt by the crons from public sources (or pure logs/caches). Daily core
// keeps their schema only; weekly full keeps everything except LOGS_AND_CACHES.
const REBUILDABLE = [
  "news_items", "bills", "state_briefings", "campaigns", "bop_findings", "policy_alerts", "federal_personal_trades",
  "legislator_committees", "legislators", "campaign_auto_approve_decisions", "bill_actions", "bill_vote_members",
  "research_papers", "lobbying_filings", "topic_bills", "bill_research_alignment", "legislator_donors", "bill_votes",
  "bill_sponsors", "court_cases", "federal_awards", "bill_cluster_members", "legislator_news_mentions",
  "legislator_stance", "legislator_kratom_stance", "notifications",
];
const LOGS_AND_CACHES = ["scraper_runs", "ai_jobs", "content_translations", "push_send_log", "rate_limits"];
const AUTH_TABLES = ["auth.users", "auth.identities", "auth.mfa_factors"]; // logins survive a restore

if (!["core", "full"].includes(MODE)) { console.error("--mode core|full"); process.exit(2); }
const noData = MODE === "core" ? [...REBUILDABLE, ...LOGS_AND_CACHES] : LOGS_AND_CACHES;
const date = new Date().toISOString().slice(0, 10);
const publicKey = fs.readFileSync(path.join(here, "backup-public-key.pem"), "utf8");

const dumps = [
  { name: "public", args: ["--schema=public", "--no-owner", "--no-privileges", ...noData.map((t) => `--exclude-table-data=public.${t}`)] },
  { name: "auth", args: ["--data-only", "--no-owner", "--no-privileges", ...AUTH_TABLES.map((t) => `--table=${t}`)] },
];

console.log(`backup ${MODE} · ${date} · data skipped for ${noData.length} table(s)${DRY ? " · DRY RUN" : ""}`);
if (DRY) { for (const d of dumps) console.log(`  pg_dump ${d.args.join(" ")}`); process.exit(0); }

async function gateFull() {
  if (MODE !== "full" || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { skip: false };
  try {
    const { checkEgressBudget } = await import("./lib/egress-budget.mjs");
    return await checkEgressBudget("bulk");
  } catch { return { skip: false }; } // budget unreadable: a backup is worth more than the guess
}

async function record(status, notes) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await sb.from("scraper_runs").insert({ source: MODE === "full" ? "db_backup_full" : "db_backup_core", started_at: startedAt, finished_at: new Date().toISOString(), status, notes: notes.slice(0, 900) });
}

const startedAt = new Date().toISOString();
const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("✗ SUPABASE_DB_URL is not set (session pooler URL, port 5432)"); await record("error", "SUPABASE_DB_URL not set"); process.exit(1); }

const gate = await gateFull();
if (gate.skip) { console.log(`full backup deferred: ${gate.reason}`); await record("partial", `deferred: ${gate.reason}`); process.exit(0); }

fs.mkdirSync(OUT, { recursive: true });
const made = [];
try {
  for (const d of dumps) {
    const file = path.join(OUT, `ikratom-${MODE}-${date}-${d.name}.sql.gz.enc`);
    const child = spawn("pg_dump", [...d.args, url], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c; });
    const exited = new Promise((res) => child.on("close", res));
    const bytes = await encryptStream(child.stdout, file, publicKey);
    const code = await exited;
    if (code !== 0) throw new Error(`pg_dump ${d.name} exited ${code}: ${stderr.trim().split("\n").slice(-2).join(" | ").slice(0, 300)}`);
    made.push(`${path.basename(file)} ${(bytes / 1e6).toFixed(2)}MB`);
    console.log(`  ✓ ${made.at(-1)}`);
  }
  await record("success", `${MODE}: ${made.join(", ")}`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  await record("error", e.message);
  process.exitCode = 1;
}
