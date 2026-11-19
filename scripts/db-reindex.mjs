/**
 * Rebuild bloated indexes without locking anything (REINDEX ... CONCURRENTLY).
 *
 * Why: tables that are updated often (news_items above all) leave dead entries
 * behind in every index, and plain VACUUM never gives that space back. On
 * 2026-11-18, news_items carried 45 MB of indexes for 24k rows. Rebuilding an
 * index changes no data, keeps reads and writes running, and returns the space
 * to the 500 MB free-plan cap at once.
 *
 * It runs one index at a time over the Management API, largest first, skips
 * indexes under --min-kb, and stops at --max-minutes. A failed concurrent
 * rebuild leaves an invalid "<name>_ccnew" copy behind; the script drops those
 * at the end so they don't sit there taking space.
 *
 * Usage:
 *   node --env-file=.env.local scripts/db-reindex.mjs            # report only
 *   node --env-file=.env.local scripts/db-reindex.mjs --apply [--min-kb 512] [--table news_items] [--max-minutes 15]
 */
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN || !REF) { console.error("Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF"); process.exit(2); }

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const APPLY = process.argv.includes("--apply");
const MIN_KB = Number(arg("--min-kb", "512"));
const TABLE = arg("--table", null);
const MAX_MINUTES = Number(arg("--max-minutes", "15"));
if (!Number.isFinite(MIN_KB) || MIN_KB < 0) { console.error("--min-kb must be a number"); process.exit(2); }
if (TABLE && !/^[a-z_][a-z0-9_]*$/.test(TABLE)) { console.error("--table must be a plain table name"); process.exit(2); }

async function sql(query, readOnly = true) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const mb = (b) => (Number(b) / 1e6).toFixed(2);
const dbBytes = async () => Number((await sql("select sum(pg_database_size(datname))::bigint as b from pg_database"))[0].b);

const list = await sql(`
  select i.relname as idx, t.relname as tbl, pg_relation_size(i.oid) as bytes
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and x.indisvalid
    and pg_relation_size(i.oid) >= ${Math.round(MIN_KB * 1024)}
    ${TABLE ? `and t.relname = '${TABLE}'` : ""}
    and i.relname !~ '_ccnew[0-9]*$'
  order by pg_relation_size(i.oid) desc`);

const before = await dbBytes();
console.log(`database: ${mb(before)} MB (all databases). ${list.length} index(es) >= ${MIN_KB} KB${TABLE ? ` on ${TABLE}` : ""}.`);
if (!APPLY) {
  for (const r of list) console.log(`  ${mb(r.bytes).padStart(7)} MB  ${r.tbl}.${r.idx}`);
  console.log("report only; pass --apply to rebuild.");
  process.exit(0);
}

const startedAt = Date.now();
const deadline = startedAt + MAX_MINUTES * 60_000;
let saved = 0, rebuilt = 0, failed = 0;
for (const r of list) {
  if (Date.now() > deadline) { console.log(`stopping: --max-minutes ${MAX_MINUTES} reached`); break; }
  try {
    await sql(`reindex index concurrently public."${r.idx}"`, false);
    const [{ bytes }] = await sql(`select pg_relation_size('public."${r.idx}"'::regclass) as bytes`);
    saved += Number(r.bytes) - Number(bytes);
    rebuilt++;
    console.log(`  ${r.tbl}.${r.idx}: ${mb(r.bytes)} -> ${mb(bytes)} MB`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${r.tbl}.${r.idx}: ${e.message}`);
  }
}

// A concurrent rebuild that fails part-way leaves an invalid copy named
// <index>_ccnew. It holds space and slows writes, so drop it.
const leftovers = await sql(`
  select i.relname as idx from pg_index x join pg_class i on i.oid = x.indexrelid
  join pg_namespace n on n.oid = i.relnamespace
  where n.nspname = 'public' and not x.indisvalid and i.relname ~ '_ccnew[0-9]*$'`);
for (const { idx } of leftovers) {
  try { await sql(`drop index concurrently if exists public."${idx}"`, false); console.log(`  dropped leftover ${idx}`); }
  catch (e) { console.error(`  ✗ leftover ${idx}: ${e.message}`); }
}

const after = await dbBytes();
const summary = `rebuilt ${rebuilt}, failed ${failed}; indexes ${mb(saved)} MB smaller; database ${mb(before)} -> ${mb(after)} MB`;
console.log(summary);

// Telemetry for check-cron-staleness (source db_reindex), when the service
// role is present. Best-effort: a failed log never fails the rebuild.
if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    await sb.from("scraper_runs").insert({
      source: "db_reindex",
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      status: failed ? (rebuilt ? "partial" : "error") : "success",
      rows_updated: rebuilt,
      notes: summary,
    });
  } catch { /* best-effort */ }
}
process.exitCode = failed ? 1 : 0;
