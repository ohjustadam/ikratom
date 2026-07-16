#!/usr/bin/env node
/**
 * migrate-supabase-project.mjs — "Lifeboat": full data migration between two
 * Supabase projects using ONLY the Management API (api.supabase.com).
 *
 * Born 2026-07-16: the prod project blew its free-tier 5GB egress cap and was
 * RESTRICTED — the project API gateway (PostgREST/Auth/Storage/Realtime)
 * refuses every request, so the app and all crons are down until the Aug 3
 * billing reset. The Management API's SQL endpoint (the same door db-push.mjs
 * uses) still works on a restricted project, so this script carries the entire
 * database — including auth.users with password hashes, so NO user has to
 * re-register — into a fresh free project with a zero egress meter.
 *
 * No pg_dump, no Docker, no direct DB connection, no DB password: reads and
 * writes both go through POST /v1/projects/{ref}/database/query. Rows travel
 * as JSON and land via jsonb_populate_recordset (no per-value SQL escaping).
 * Loads run inside `session_replication_role = replica` transactions so
 * triggers (notification gates, auto-campaign spawns) and FK ordering can't
 * misfire during restore. Inserts are ON CONFLICT DO NOTHING → fully re-runnable.
 *
 * Phases (run in order):
 *   --dry-run    read-only: inventory + per-table counts + batch plan (OLD only)
 *   --schema     replay supabase/migrations/*.sql onto the NEW project
 *   --copy       copy data (auth.users/identities/mfa_factors, storage.buckets,
 *                then all public tables). [--only <table>] [--skip <t1,t2>]
 *   --verify     per-table row counts old vs new + schema drift report
 *   --finalize   reset sequences + sync realtime publication on NEW
 *
 * Env: SUPABASE_ACCESS_TOKEN (account-wide), SUPABASE_PROJECT_REF (OLD/source),
 *      MIGRATE_TARGET_REF (NEW/destination).
 *
 * Usage:
 *   node --env-file=.env.local scripts/migrate-supabase-project.mjs --dry-run
 *   node --env-file=.env.local scripts/migrate-supabase-project.mjs --schema
 *   node --env-file=.env.local scripts/migrate-supabase-project.mjs --copy
 *   node --env-file=.env.local scripts/migrate-supabase-project.mjs --verify
 *   node --env-file=.env.local scripts/migrate-supabase-project.mjs --finalize
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const OLD_REF = process.env.SUPABASE_PROJECT_REF;
const NEW_REF = process.env.MIGRATE_TARGET_REF;

const args = process.argv.slice(2);
const MODE = ["--dry-run", "--schema", "--copy", "--verify", "--finalize"].find((m) => args.includes(m));
const onlyIdx = args.indexOf("--only");
const ONLY = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const skipIdx = args.indexOf("--skip");
const SKIP = new Set(skipIdx >= 0 ? args[skipIdx + 1].split(",") : []);

if (!TOKEN || !OLD_REF) { console.error("Missing SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF"); process.exit(1); }
if (!MODE) { console.error("Pick a mode: --dry-run | --schema | --copy | --verify | --finalize"); process.exit(1); }
if (MODE !== "--dry-run" && !NEW_REF) { console.error("Missing MIGRATE_TARGET_REF (the NEW project ref)"); process.exit(1); }
if (NEW_REF && NEW_REF === OLD_REF) { console.error("MIGRATE_TARGET_REF equals SUPABASE_PROJECT_REF — refusing."); process.exit(1); }

// ---------- Management API SQL runner (retry + adaptive) ----------
async function runSql(ref, sql, { attempts = 5 } = {}) {
  let delay = 1500;
  for (let i = 1; i <= attempts; i++) {
    let res;
    try {
      res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      });
    } catch (e) {
      if (i === attempts) throw e;
      await sleep(delay); delay *= 2; continue;
    }
    if (res.ok) return res.json();
    const body = await res.text();
    // 429/5xx → backoff and retry; anything else is a real SQL error.
    if ((res.status === 429 || res.status >= 500) && i < attempts) {
      await sleep(delay); delay *= 2; continue;
    }
    throw new Error(`[${ref}] ${res.status}: ${body.slice(0, 400)}`);
  }
}
const qOld = (sql) => runSql(OLD_REF, sql);
const qNew = (sql) => runSql(NEW_REF, sql);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qi = (s) => '"' + s.replaceAll('"', '""') + '"'; // quote ident

// ---------- Table + column discovery ----------
// Copy order: auth first (public.profiles FKs auth.users), storage.buckets
// (RLS policies from migrations reference them), then public.
const AUTH_TABLES = ["auth.users", "auth.identities", "auth.mfa_factors"];
const STORAGE_TABLES = ["storage.buckets"]; // objects metadata skipped: files don't travel via SQL; brief audio re-renders via cron
const EXCLUDE_PUBLIC = new Set(["_ikratom_migrations"]); // --schema replay owns this

async function listPublicTables() {
  const rows = await qOld(`select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by table_name`);
  return rows.map((r) => r.table_name).filter((t) => !EXCLUDE_PUBLIC.has(t));
}

// Insertable columns = intersection of old+new, minus generated columns.
// identity_generation='ALWAYS' columns force OVERRIDING SYSTEM VALUE.
async function columnPlan(fq) {
  const [schema, table] = fq.split(".");
  const colSql = (extra) => `select column_name, is_generated, identity_generation
    from information_schema.columns where table_schema='${schema}' and table_name='${table}'${extra ?? ""}`;
  const oldCols = await qOld(colSql());
  const newCols = await qNew(colSql());
  const newByName = new Map(newCols.map((c) => [c.column_name, c]));
  const cols = [];
  let overriding = false;
  const droppedOnNew = [];
  for (const c of oldCols) {
    if (c.is_generated === "ALWAYS") continue; // computed — never insert
    const n = newByName.get(c.column_name);
    if (!n) { droppedOnNew.push(c.column_name); continue; }
    if (n.is_generated === "ALWAYS") continue;
    if (n.identity_generation === "ALWAYS") overriding = true;
    cols.push(c.column_name);
  }
  return { cols, overriding, droppedOnNew };
}

async function pkOf(fq) {
  const [schema, table] = fq.split(".");
  const rows = await qOld(`select a.attname from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and n.nspname='${schema}' and c.relname='${table}'
    order by array_position(i.indkey, a.attnum)`);
  return rows.map((r) => r.attname);
}

async function countOn(q, fq) {
  const r = await q(`select count(*)::bigint as n from ${fq}`);
  return Number(r[0].n);
}

async function batchSizeFor(fq, rowCount) {
  const [schema, table] = fq.split(".");
  const r = await qOld(`select pg_total_relation_size(c.oid) as bytes from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='${schema}' and c.relname='${table}'`);
  const avg = Math.max(64, Number(r[0]?.bytes ?? 0) / Math.max(1, rowCount));
  // Target ~1.5MB of JSON per batch (relation size overcounts vs JSON, safe direction).
  return Math.max(25, Math.min(2000, Math.floor(1_500_000 / avg)));
}

// ---------- Copy one table ----------
async function copyTable(fq) {
  const total = await countOn(qOld, fq);
  if (total === 0) { console.log(`  ${fq}: empty — skip`); return { fq, total: 0, copied: 0 }; }
  const { cols, overriding, droppedOnNew } = await columnPlan(fq);
  if (droppedOnNew.length) console.log(`  ⚠ ${fq}: columns missing on NEW, not copied: ${droppedOnNew.join(", ")}`);
  if (cols.length === 0) { console.log(`  ⚠ ${fq}: no shared columns — skip`); return { fq, total, copied: 0 }; }
  const pk = await pkOf(fq);
  const colList = cols.map(qi).join(", ");
  let batch = await batchSizeFor(fq, total);
  const keyset = pk.length >= 1; // tuple keyset works for composite PKs too
  const orderBy = pk.length ? pk.map(qi).join(", ") : cols.slice(0, 1).map(qi).join(", ");

  let copied = 0;
  let lastKey = null; // array of PK values
  let offset = 0;
  while (copied < total) {
    // READ a batch from OLD as one JSON blob
    let where = "";
    if (keyset && lastKey) {
      const tuple = pk.map(qi).join(", ");
      const vals = lastKey.map((v) => (v === null ? "null" : `${sqlLit(v)}`)).join(", ");
      where = `where (${tuple}) > (${vals})`;
    }
    const readSql = keyset
      ? `select coalesce(jsonb_agg(t), '[]'::jsonb) as data from (select ${colList}, ${pk.map(qi).join(", ")} from ${fq} ${where} order by ${orderBy} limit ${batch}) t`
      : `select coalesce(jsonb_agg(t), '[]'::jsonb) as data from (select ${colList} from ${fq} order by ${orderBy} limit ${batch} offset ${offset}) t`;
    let rows;
    try {
      rows = (await qOld(readSql))[0].data;
    } catch (e) {
      if (batch > 25) { batch = Math.max(25, Math.floor(batch / 2)); console.log(`    ↓ read failed, halving batch to ${batch}`); continue; }
      throw e;
    }
    if (!rows.length) break;

    // WRITE the batch into NEW inside a replica-mode transaction.
    // First batch DELETEs existing rows (exact-mirror semantics): migrations
    // seed some tables (states, site_config, …) and ON CONFLICT DO NOTHING
    // would let stale seeds beat live prod values. Replica mode suspends FKs,
    // so the delete+reload is safe; re-running a table restarts the mirror.
    const json = JSON.stringify(rows).replaceAll("\\u0000", ""); // PG jsonb rejects NUL
    const tag = "$mig" + Math.random().toString(36).slice(2, 8) + "$";
    const firstBatch = copied === 0 && (keyset ? lastKey === null : offset === 0);
    const insertSql = `begin;
set local session_replication_role = replica;
${firstBatch ? `delete from ${fq};` : ""}
insert into ${fq} (${colList}) ${overriding ? "overriding system value " : ""}
select ${colList} from jsonb_populate_recordset(null::${fq}, ${tag}${json}${tag}::jsonb)
on conflict do nothing;
commit;`;
    try {
      await qNew(insertSql);
    } catch (e) {
      if (batch > 25) { batch = Math.max(25, Math.floor(batch / 2)); console.log(`    ↓ write failed (${e.message.slice(0, 80)}), halving batch to ${batch}`); continue; }
      throw e;
    }

    copied += rows.length;
    if (keyset) lastKey = pk.map((k) => rows[rows.length - 1][k]);
    else offset += rows.length;
    process.stdout.write(`  ${fq}: ${copied}/${total}\r`);
    await sleep(120); // stay polite to the Management API rate limit
  }
  console.log(`  ${fq}: ${copied}/${total} ✓`);
  return { fq, total, copied };
}

// SQL literal for keyset WHERE values (strings/uuids/timestamps quoted; numbers raw)
function sqlLit(v) {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return "'" + String(v).replaceAll("'", "''") + "'";
}

// ---------- Modes ----------
async function main() {
  if (MODE === "--dry-run") {
    console.log(`DRY RUN — source ${OLD_REF} (read-only)\n`);
    const tables = [...AUTH_TABLES, ...STORAGE_TABLES, ...(await listPublicTables()).map((t) => `public.${qi(t)}`)];
    let grand = 0;
    for (const fq of tables) {
      const n = await countOn(qOld, fq).catch((e) => `ERR ${e.message.slice(0, 60)}`);
      if (typeof n === "number") grand += n;
      console.log(`  ${String(n).padStart(8)}  ${fq}`);
    }
    console.log(`\nTotal rows to carry: ${grand}`);
    return;
  }

  if (MODE === "--schema") {
    console.log(`SCHEMA replay → ${NEW_REF}`);
    const dir = "supabase/migrations";
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    // Bootstrap the tracking table so post-migration db-push stays consistent.
    await qNew(`create table if not exists public._ikratom_migrations (
      name text primary key, applied_at timestamptz not null default now(), checksum text)`);
    const done = new Set((await qNew(`select name from public._ikratom_migrations`)).map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) { console.log(`  = ${f} (already applied)`); continue; }
      const sql = readFileSync(join(dir, f), "utf8");
      try {
        await runSql(NEW_REF, sql, { attempts: 2 });
        await qNew(`insert into public._ikratom_migrations (name) values ('${f.replaceAll("'", "''")}') on conflict do nothing`);
        console.log(`  ✓ ${f}`);
      } catch (e) {
        console.error(`  ✗ ${f}: ${e.message.slice(0, 300)}`);
        console.error("  Stopping — fix the migration (or mark it applied) and re-run --schema.");
        process.exit(1);
      }
    }
    console.log("Schema replay complete.");
    return;
  }

  if (MODE === "--copy") {
    console.log(`COPY ${OLD_REF} → ${NEW_REF}\n`);
    const publicTables = (await listPublicTables()).map((t) => `public.${qi(t)}`);
    let tables = [...AUTH_TABLES, ...STORAGE_TABLES, ...publicTables];
    if (ONLY) tables = tables.filter((t) => t.includes(ONLY));
    tables = tables.filter((t) => ![...SKIP].some((s) => t.includes(s)));
    const results = [];
    for (const fq of tables) results.push(await copyTable(fq));
    const bad = results.filter((r) => r.copied < r.total);
    console.log(`\nCopy pass done — ${results.length} tables.` + (bad.length ? ` ⚠ INCOMPLETE: ${bad.map((b) => b.fq).join(", ")} (re-run --copy; inserts are idempotent)` : " All complete."));
    return;
  }

  if (MODE === "--verify") {
    console.log(`VERIFY ${OLD_REF} vs ${NEW_REF}\n`);
    const tables = [...AUTH_TABLES, ...STORAGE_TABLES, ...(await listPublicTables()).map((t) => `public.${qi(t)}`)];
    let mismatches = 0;
    for (const fq of tables) {
      const [a, b] = await Promise.all([countOn(qOld, fq), countOn(qNew, fq).catch(() => -1)]);
      const ok = a === b;
      if (!ok) mismatches++;
      console.log(`  ${ok ? "✓" : "✗"} ${fq}: old=${a} new=${b}`);
    }
    // Schema drift: columns present on OLD but absent on NEW (public schema)
    const drift = await qOld(`select table_name || '.' || column_name as col from information_schema.columns
      where table_schema='public'`).then(async (oldCols) => {
        const newCols = new Set((await qNew(`select table_name || '.' || column_name as col from information_schema.columns
          where table_schema='public'`)).map((r) => r.col));
        return oldCols.map((r) => r.col).filter((c) => !newCols.has(c));
      });
    if (drift.length) console.log(`\n⚠ Columns on OLD missing from NEW (manual drift — reconcile): ${drift.join(", ")}`);
    console.log(`\n${mismatches === 0 && drift.length === 0 ? "ALL GREEN — safe to cut over." : `${mismatches} count mismatches, ${drift.length} drift columns.`}`);
    return;
  }

  if (MODE === "--finalize") {
    console.log(`FINALIZE ${NEW_REF}\n`);
    // 1. Reset every owned sequence to max(column) so new inserts don't collide.
    const seqs = await qNew(`select 'select setval(' || quote_literal(s.oid::regclass::text) || ', coalesce((select max(' || quote_ident(a.attname) || ') from ' || quote_ident(n.nspname) || '.' || quote_ident(t.relname) || '), 1))' as stmt
      from pg_class s
      join pg_depend d on d.objid = s.oid and d.deptype in ('a','i')
      join pg_class t on t.oid = d.refobjid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      where s.relkind = 'S' and n.nspname in ('public','auth','storage')`);
    for (const r of seqs) { await qNew(r.stmt); }
    console.log(`  ✓ ${seqs.length} sequences reset`);
    // 2. Realtime publication parity.
    const wanted = (await qOld(`select schemaname || '.' || tablename as t from pg_publication_tables where pubname='supabase_realtime'`)).map((r) => r.t);
    const have = new Set((await qNew(`select schemaname || '.' || tablename as t from pg_publication_tables where pubname='supabase_realtime'`)).map((r) => r.t));
    for (const t of wanted) {
      if (!have.has(t)) { await qNew(`alter publication supabase_realtime add table ${t}`); console.log(`  ✓ realtime: added ${t}`); }
    }
    console.log(`  ✓ realtime publication parity (${wanted.length} tables)`);
    // 3. REPLICA IDENTITY parity (realtime DELETE filtering pitfall #2 in AGENTS.md).
    const idents = await qOld(`select n.nspname || '.' || c.relname as t, c.relreplident from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relreplident = 'f'`);
    for (const r of idents) { await qNew(`alter table ${r.t} replica identity full`); console.log(`  ✓ replica identity full: ${r.t}`); }
    console.log("\nFinalize complete. Cut over env vars, redeploy, and smoke-test login.");
    return;
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
