#!/usr/bin/env node
/**
 * netlify-env-sync.mjs — push every runtime secret from .env.local to a Netlify
 * site in one shot, so the migration off Vercel doesn't mean re-typing ~74
 * environment variables by hand into a web form.
 *
 *   node --env-file=.env.local scripts/netlify-env-sync.mjs --dry-run
 *   node --env-file=.env.local scripts/netlify-env-sync.mjs
 *
 * Requires in .env.local (owner adds after creating the Netlify site):
 *   NETLIFY_AUTH_TOKEN   — Netlify → User settings → Applications → New access token
 *   NETLIFY_SITE_ID      — optional; if absent, we match a site named "ikratom"
 *
 * What it does NOT push (deliberately):
 *   - OLD_*                — deprecated pre-lifeboat Supabase values
 *   - MIGRATE_TARGET_*     — one-time Supabase-migration creds, not app runtime
 *   - VERCEL_TOKEN         — Vercel-specific, irrelevant on Netlify
 *   - empty values         — nothing to set
 *   - NETLIFY_*            — don't feed the deploy creds back into the app
 *
 * What it OVERRIDES:
 *   - APP_URL → https://www.ikratom.org  (the local file holds the dev value
 *     http://localhost:3001, which must never reach a production build)
 *
 * Read-only against .env.local. Writes only to Netlify. Idempotent — re-running
 * updates existing keys rather than duplicating them.
 */
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry-run");
const TOKEN = process.env.NETLIFY_AUTH_TOKEN;
if (!TOKEN) {
  console.error("Missing NETLIFY_AUTH_TOKEN in .env.local (Netlify → User settings → Applications → New access token).");
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

// ── Parse .env.local ourselves (not process.env) so we control exactly what
//    ships and can apply the skip/override rules precisely. ─────────────────
const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const SKIP_PREFIX = ["OLD_", "MIGRATE_TARGET_", "NETLIFY_"];
const SKIP_EXACT = new Set(["VERCEL_TOKEN"]);
const OVERRIDE = { APP_URL: "https://www.ikratom.org" };

const vars = {};
for (const line of raw.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!m) continue; // comment or blank
  const key = m[1];
  let val = m[2].trim().replace(/^["']|["']$/g, "");
  if (SKIP_PREFIX.some((p) => key.startsWith(p))) continue;
  if (SKIP_EXACT.has(key)) continue;
  if (key in OVERRIDE) val = OVERRIDE[key];
  if (val === "") continue;
  vars[key] = val;
}
const keys = Object.keys(vars).sort();
console.log(`Parsed ${keys.length} env vars to sync (after skip/override rules).`);

// ── Resolve the target site. ────────────────────────────────────────────────
async function api(path, init) {
  const res = await fetch(`https://api.netlify.com/api/v1${path}`, { headers: H, ...init });
  const text = await res.text();
  let body = text; try { body = JSON.parse(text); } catch { /* */ }
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${path} → ${res.status}: ${typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

let siteId = process.env.NETLIFY_SITE_ID;
let accountId;
if (!siteId) {
  const sites = await api("/sites");
  const match = sites.find((s) => /ikratom/i.test(s.name || "") || /ikratom/i.test(s.custom_domain || ""));
  if (!match) { console.error(`No NETLIFY_SITE_ID set and no site matching "ikratom" found. Sites: ${sites.map((s) => s.name).join(", ") || "(none)"}`); process.exit(1); }
  siteId = match.id; accountId = match.account_slug;
  console.log(`Matched site "${match.name}" (${siteId}).`);
} else {
  const site = await api(`/sites/${siteId}`);
  accountId = site.account_slug;
  console.log(`Target site "${site.name}" (${siteId}).`);
}

if (DRY) {
  console.log("\n--- DRY RUN — would set these keys (values hidden) ---");
  for (const k of keys) console.log(`  ${k}`);
  console.log(`\n${keys.length} keys. Re-run without --dry-run to apply.`);
  process.exit(0);
}

// ── Bulk create/update. The account-scoped env API upserts by key. ──────────
const payload = keys.map((k) => ({
  key: k,
  scopes: ["builds", "functions", "runtime", "post_processing"],
  values: [{ value: vars[k], context: "all" }],
}));

// Create in one bulk call; if a key already exists the API 422s the whole
// batch, so on conflict fall back to per-key PUT (update) which is idempotent.
try {
  await api(`/accounts/${accountId}/env?site_id=${siteId}`, { method: "POST", body: JSON.stringify(payload) });
  console.log(`\n✓ Created ${keys.length} env vars on the site.`);
} catch (e) {
  console.log(`Bulk create failed (likely some keys exist): ${e.message}\nFalling back to per-key upsert…`);
  let ok = 0;
  for (const k of keys) {
    try {
      // PUT updates an existing key; POST creates. Try PUT, fall back to POST.
      await api(`/accounts/${accountId}/env/${encodeURIComponent(k)}?site_id=${siteId}`, {
        method: "PUT",
        body: JSON.stringify({ scopes: ["builds", "functions", "runtime", "post_processing"], values: [{ value: vars[k], context: "all" }] }),
      }).catch(async () => {
        await api(`/accounts/${accountId}/env?site_id=${siteId}`, {
          method: "POST",
          body: JSON.stringify([{ key: k, scopes: ["builds", "functions", "runtime", "post_processing"], values: [{ value: vars[k], context: "all" }] }]),
        });
      });
      ok++;
    } catch (err) { console.error(`  ✗ ${k}: ${err.message}`); }
  }
  console.log(`\n✓ Upserted ${ok}/${keys.length} env vars.`);
}
console.log("Done. Trigger a fresh deploy so the new vars take effect.");
