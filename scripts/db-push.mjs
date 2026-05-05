#!/usr/bin/env node
/**
 * iKratom — auto-push pending Supabase migrations.
 *
 * Reads supabase/migrations/*.sql, tracks applied ones in
 * public._ikratom_migrations, and runs anything new via the Supabase
 * Management API.
 *
 * Run with:
 *   node --env-file=.env.local scripts/db-push.mjs
 *   node --env-file=.env.local scripts/db-push.mjs --dry-run
 *   node --env-file=.env.local scripts/db-push.mjs --force <name>   # re-run a specific one
 *
 * Requires SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF in env.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const MIGRATIONS_DIR = "supabase/migrations";

if (!TOKEN) { console.error("Missing SUPABASE_ACCESS_TOKEN"); process.exit(1); }
if (!PROJECT_REF) { console.error("Missing SUPABASE_PROJECT_REF"); process.exit(1); }

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const forceIdx = args.indexOf("--force");
const forceName = forceIdx >= 0 ? args[forceIdx + 1] : null;

async function runSql(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body.slice(0, 500)}`);
  }
  return res.json();
}

// Bootstrap our tracking table on every run (idempotent)
const BOOTSTRAP = `
create table if not exists public._ikratom_migrations (
  name text primary key,
  applied_at timestamptz not null default now(),
  checksum text
);
`;

async function main() {
  console.log("Bootstrapping migration tracker…");
  await runSql(BOOTSTRAP);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Get applied list — Management API returns rows as a flat array
  const rows = await runSql("select name from public._ikratom_migrations;");
  const applied = new Set((Array.isArray(rows) ? rows : []).map((r) => r.name));
  console.log(`${applied.size} already applied, ${files.length} total in folder.`);

  let appliedThisRun = 0;
  let failed = 0;

  for (const file of files) {
    if (applied.has(file) && file !== forceName) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    process.stdout.write(`  applying ${file}… `);

    if (dryRun) {
      console.log(`(dry-run, ${sql.length} chars)`);
      continue;
    }

    try {
      await runSql(sql);
      // Mark applied (replace if force)
      await runSql(
        `insert into public._ikratom_migrations (name)
         values ('${file.replace(/'/g, "''")}')
         on conflict (name) do update set applied_at = now();`,
      );
      console.log("✓");
      appliedThisRun++;
    } catch (e) {
      console.log(`✗ ${e.message}`);
      failed++;
      break; // stop on first failure to avoid cascading damage
    }
  }

  console.log(`\nDone — applied ${appliedThisRun}, failed ${failed}.`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
