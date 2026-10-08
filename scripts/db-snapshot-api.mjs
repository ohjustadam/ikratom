#!/usr/bin/env node
/**
 * db-snapshot-api.mjs — encrypted data snapshot WITHOUT a database password.
 *
 * WHY (2026-10-05): db-backup.mjs needs pg_dump and SUPABASE_DB_URL (the DB
 * password), which only the owner can paste into GitHub secrets. Until then
 * there were ZERO backups. This reads every table through the Supabase
 * Management API with the SUPABASE_ACCESS_TOKEN the repo's scripts already use,
 * so a backup can exist TODAY, on the owner's own disk, before any setup.
 *
 * What it holds: every row of every public table EXCEPT the ones the crons
 * rebuild from public sources and pure logs/caches (same lists as
 * db-backup.mjs), plus auth.users / auth.identities / auth.mfa_factors so
 * logins survive a restore. Schema is not included — it lives in
 * supabase/migrations. Format: gzip'd JSON lines, one {"table","row"} per line,
 * sealed with scripts/backup-public-key.pem (only the owner's private key opens
 * it). Restore one table:
 *   insert into public.<t> select * from json_populate_recordset(null::public.<t>, '<json array>');
 *
 *   node --env-file=.env.local scripts/db-snapshot-api.mjs --out C:/claude/ikratom-backups
 *   node --env-file=.env.local scripts/db-snapshot-api.mjs --verify <file> --key private/backup-private-key.pem
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { encryptStream, decryptFile, inspect } from "./lib/backup-crypto.mjs";
import { assessSnapshot, countsFromStats, DEFAULT_MIN_ROWS } from "./lib/snapshot-guard.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const here = path.dirname(fileURLToPath(import.meta.url));
// Secrets pasted through a Windows shell can arrive with a byte-order mark or a
// trailing newline. Node rejects a BOM in a header ("Cannot convert argument to
// a ByteString ... 65279"), which failed every cloud backup on 2026-10-05/06.
const cleanSecret = (v) => (v ?? "").replace(/^﻿/, "").trim();
const REF = cleanSecret(process.env.SUPABASE_PROJECT_REF) || (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
const TOKEN = cleanSecret(process.env.SUPABASE_ACCESS_TOKEN);

// Keep in step with db-backup.mjs: rebuilt from public sources, or logs/caches.
const REBUILDABLE = [
  "news_items", "bills", "state_briefings", "campaigns", "bop_findings", "policy_alerts", "federal_personal_trades",
  "legislator_committees", "legislators", "campaign_auto_approve_decisions", "bill_actions", "bill_vote_members",
  "research_papers", "lobbying_filings", "topic_bills", "bill_research_alignment", "legislator_donors", "bill_votes",
  "bill_sponsors", "court_cases", "federal_awards", "bill_cluster_members", "legislator_news_mentions",
  "legislator_stance", "legislator_kratom_stance", "notifications",
];
const LOGS_AND_CACHES = ["scraper_runs", "ai_jobs", "content_translations", "push_send_log", "rate_limits"];
const AUTH_TABLES = ["auth.users", "auth.identities", "auth.mfa_factors"];
const PAGE = 1000;

async function sql(query) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
    });
    if (r.ok) return r.json();
    if (attempt >= 4 || (r.status < 500 && r.status !== 429)) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    await new Promise((res) => setTimeout(res, 2000 * attempt));
  }
}

async function* rows(tables, stats) {
  for (const t of tables) {
    const q = t.includes(".") ? t : `public.${t}`;
    let n = 0;
    for (let off = 0; ; off += PAGE) {
      // ctid order is stable for a point-in-time read; enough for a snapshot.
      const page = await sql(`select coalesce(json_agg(x), '[]'::json) as rows from (select * from ${q} order by ctid offset ${off} limit ${PAGE}) x`);
      const list = page[0]?.rows ?? [];
      for (const row of list) yield JSON.stringify({ table: q, row }) + "\n";
      n += list.length;
      if (list.length < PAGE) break;
    }
    stats.push(`${q}=${n}`);
  }
}

if (argv.includes("--verify")) {
  const file = arg("verify"), keyPath = arg("key", "private/backup-private-key.pem");
  const tmp = `${file}.verify.tmp`;
  decryptFile(file, tmp, fs.readFileSync(keyPath, "utf8"));
  const counts = {};
  for (const line of fs.readFileSync(tmp, "utf8").split("\n")) {
    if (!line) continue;
    const { table } = JSON.parse(line);
    counts[table] = (counts[table] ?? 0) + 1;
  }
  fs.rmSync(tmp);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`✓ decrypts and parses: ${total} rows in ${Object.keys(counts).length} tables`);
  for (const t of ["auth.users", "public.profiles", "public.campaign_actions", "public.municipal_meetings"]) console.log(`  ${t}: ${counts[t] ?? 0}`);
  process.exit(0);
}

if (!REF || !TOKEN) { console.error("needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF (or NEXT_PUBLIC_SUPABASE_URL)"); process.exit(1); }
const out = arg("out", "backup-out");
fs.mkdirSync(out, { recursive: true });

const skip = new Set([...REBUILDABLE, ...LOGS_AND_CACHES]);
const list = (await sql("select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name"))
  .map((r) => r.table_name).filter((t) => !skip.has(t));
const tables = [...list, ...AUTH_TABLES];

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const file = path.join(out, `ikratom-snapshot-${stamp}.jsonl.gz.enc`);
const stats = [];
const t0 = Date.now();
const bytes = await encryptStream(Readable.from(rows(tables, stats)), file, fs.readFileSync(path.join(here, "backup-public-key.pem"), "utf8"));
console.log(`✓ ${file} · ${(bytes / 1e6).toFixed(2)} MB encrypted · ${tables.length} tables · ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(`  ${stats.filter((s) => !s.endsWith("=0")).join(" ")}`);

// ─── NON-VACUITY GUARD (2026-10-08) ──────────────────────────────────────────
//
// Until now this script reported `status: "success"` unconditionally, as soon as
// encryptStream resolved. Nothing checked that anything had actually been
// captured. So if the Management API had returned `[]` for every table — an
// expired token, a permissions change, a schema rename — this would have written
// a tiny well-formed .enc file, printed a ✓, uploaded it as the day's backup and
// recorded a successful run. The workflow's `if-no-files-found: error` does not
// help: the file exists, it is just empty. A backup that reports success while
// holding nothing is worse than a backup that fails, because the failure is
// discovered at restore time.
//
// This CANNOT be a decrypt-and-count check in CI, and that is deliberate: the
// private key is not a GitHub secret and must never become one, or the cloud
// gains the ability to read every account. So the checks here are all key-free —
// counts taken from the plaintext as it streamed past, plus inspect(), which
// validates the sealed file's magic, wrapped-key length and minimum size without
// opening it.
//
// FUTURE (not built): compare rowsTotal against the previous successful run in
// scraper_runs and fail on a large drop. That would also catch partial capture,
// not just total emptiness. Left out because it makes the guard depend on
// telemetry history, and a brittle guard gets deleted.
// The decision itself lives in scripts/lib/snapshot-guard.mjs so that every
// branch of it is reachable from tests/backup-crypto.test.ts without a
// database, a key or a network call.
const { ok: verdict, problems, rowsTotal, critical } = assessSnapshot({
  counts: countsFromStats(stats),
  sealed: inspect(file),
  minRows: Number(arg("min-rows", String(DEFAULT_MIN_ROWS))),
});

if (verdict) {
  console.log(`✓ guard: ${critical} · ${rowsTotal} rows · seal intact`);
} else {
  console.error(`✗ guard FAILED — this backup is not trustworthy:`);
  for (const p of problems) console.error(`    · ${p}`);
}

// Telemetry for the staleness pager (source db_snapshot_api), when run with the
// service-role env (CI). A silent backup job is a silent loss of every account —
// and so is a LOUDLY SUCCESSFUL one that captured nothing, hence `status` now
// follows the guard instead of being hardcoded.
if (process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    await sb.from("scraper_runs").insert({
      source: "db_snapshot_api",
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      status: verdict ? "success" : "error",
      rows_updated: rowsTotal,
      error_message: verdict ? null : problems.join("; ").slice(0, 400),
      notes: `${path.basename(file)} ${(bytes / 1e6).toFixed(2)}MB · ${tables.length} tables · ${rowsTotal} rows · ${critical}`,
    });
  } catch { /* best-effort: telemetry must never be the thing that breaks a run */ }
}

// Exit non-zero so the workflow step fails and `Keep the encrypted snapshot`
// never runs — an untrustworthy file must not be uploaded as the day's backup.
if (!verdict) process.exit(1);
