/**
 * store-dispatch-token.mjs — hand the database clock its GitHub token.
 *
 * Migration 0263 makes Supabase pg_cron start cron-hourly / cron-daily on time
 * (GitHub's own schedule runs hours late). The clock needs a GitHub token that
 * can start workflows; this stores it in Supabase Vault as
 * 'github_dispatch_token'. The value is never printed.
 *
 * Owner steps:
 *   1. Create a fine-grained token: https://github.com/settings/personal-access-tokens/new
 *      Repository access: Only select repositories -> ikratom
 *      Permissions -> Repository -> Actions: Read and write   (nothing else)
 *   2. Add a line to .env.local:  GITHUB_DISPATCH_TOKEN=<the token>
 *   3. node --env-file=.env.local scripts/store-dispatch-token.mjs
 *
 * Re-run any time to replace it (e.g. when the token expires).
 */
const clean = (v) => (v ?? "").replace(/^﻿/, "").trim();
const TOKEN = clean(process.env.GITHUB_DISPATCH_TOKEN);
const SB_TOKEN = clean(process.env.SUPABASE_ACCESS_TOKEN);
const REF = clean(process.env.SUPABASE_PROJECT_REF) || (process.env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\./)?.[1];
const REPO = "ohjustadam/ikratom";

const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };
if (!TOKEN) fail("GITHUB_DISPATCH_TOKEN is not in .env.local (see the steps at the top of this file)");
if (!/^[A-Za-z0-9_]+$/.test(TOKEN)) fail("GITHUB_DISPATCH_TOKEN has unexpected characters — copy it again from GitHub");
if (!SB_TOKEN || !REF) fail("SUPABASE_ACCESS_TOKEN / project ref missing from .env.local");

// 1. Can this token see the repo's workflows? (Read check; starting one is tested after storing.)
const gh = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/cron-hourly.yml`, {
  headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "ikratom-store-dispatch-token" },
});
if (gh.status !== 200) fail(`GitHub rejected the token (${gh.status}). It needs access to ${REPO} with Actions: Read and write.`);
console.log("✓ GitHub accepts the token for this repo's workflows");

// 2. Store (or replace) it in Vault.
const sql = `
  do $$
  declare sid uuid;
  begin
    select id into sid from vault.secrets where name = 'github_dispatch_token';
    if sid is null then
      perform vault.create_secret('${TOKEN}', 'github_dispatch_token',
        'GitHub fine-grained token, Actions read/write on ${REPO}; used by the pg_cron dispatch clock (migration 0263)');
    else
      perform vault.update_secret(sid, '${TOKEN}');
    end if;
  end $$;
  select count(*)::int as stored from vault.secrets where name = 'github_dispatch_token';`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${SB_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const out = await r.json().catch(() => null);
if (!r.ok || out?.[0]?.stored !== 1) fail(`could not store it in Vault (${r.status})`);
console.log("✓ stored in Supabase Vault as github_dispatch_token");
console.log("Next: the database clock starts the every-2-hours and daily jobs on time from the next slot.");
