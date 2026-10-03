#!/usr/bin/env node
/**
 * run-push-fanout.mjs — deliver pending notifications as web push from GitHub
 * Actions, using the SAME module the site uses.
 *
 * WHY (2026-10-03): the only caller of fanoutPushNotifications() was the Netlify
 * route /api/cron/fire-waves. When Netlify disabled the site on 2026-10-02, every
 * notification the crons kept writing (meetings, alerts, digests) sat in the
 * table undelivered — and anything older than 24h is skipped as stale, so a
 * multi-day outage silently drops pushes. It also cost a Netlify function
 * invocation every hour. Running it here removes both problems.
 *
 * No logic is copied: jiti loads src/modules/notifications/push-fanout.ts with
 * the `@/` alias, so the rate-cap, coalescing, DND and opt-out rules are the
 * site's own. The Netlify route still fans out too; the two are safe together
 * because a delivered row is stamped `pushed_at` and the per-user rate cap holds.
 *
 *   node --env-file=.env.local scripts/run-push-fanout.mjs --check   # load only, send nothing
 *   node --env-file=.env.local scripts/run-push-fanout.mjs           # deliver
 *
 * Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID keys.
 * jiti ships with the build toolchain, so the job runs a full `npm ci`.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(root, "src") }, interopDefault: true });
const { fanoutPushNotifications } = await jiti.import(path.join(root, "src/modules/notifications/push-fanout.ts"));

if (process.argv.includes("--check")) {
  console.log(`push fan-out module loaded: ${typeof fanoutPushNotifications} (nothing sent)`);
  process.exit(typeof fanoutPushNotifications === "function" ? 0 : 1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const startedAt = new Date().toISOString();
let status = "success", notes = "";
try {
  const r = await fanoutPushNotifications(sb);
  notes = JSON.stringify(r).slice(0, 900);
  console.log("fan-out:", notes);
} catch (e) {
  status = "error"; notes = e.message;
  console.error("✗", e.message);
}
await sb.from("scraper_runs").insert({ source: "push_fanout_actions", started_at: startedAt, finished_at: new Date().toISOString(), status, notes });
process.exit(status === "error" ? 1 : 0);
