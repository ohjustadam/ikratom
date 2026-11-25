#!/usr/bin/env node
/**
 * crawl-stage.mjs — read or change how much of the site search engines are
 * invited into (`site_config.crawl_stage`, src/lib/crawl-policy.ts).
 *
 *   node --env-file=.env.local scripts/crawl-stage.mjs status
 *   node --env-file=.env.local scripts/crawl-stage.mjs set 1 --yes        # raise (needs a calm credit meter)
 *   node --env-file=.env.local scripts/crawl-stage.mjs set 0 --yes        # the brake: always allowed
 *   node --env-file=.env.local scripts/crawl-stage.mjs set 2 --yes --force   # raise anyway (blind or over 80%)
 *
 * Stages: 0 = everything cost-controlled stays blocked; 1 = + research and
 * bills; 2 = + legislators and briefings; 3 = + library and topics. robots.txt
 * and sitemap.xml follow within the hour (their ISR window); no deploy.
 *
 * Raising refuses when the Netlify credit meter is at 80% or cannot be read
 * (override with --force). Before you raise it, run
 * `node --env-file=.env.local scripts/crawl-lift-check.mjs --stage <n>`.
 * Runbook: docs/RUNBOOK_crawl_lift.md.
 */
import { createClient } from "@supabase/supabase-js";
import { readTrueCredits } from "./lib/netlify-credits.mjs";
import { liftAllowed } from "./lib/crawl-brake.mjs";

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "status";
const YES = argv.includes("--yes");
const FORCE = argv.includes("--force");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing Supabase env (run with --env-file=.env.local)."); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const FAMILIES = {
  0: "nothing open: every cost-controlled family stays blocked",
  1: "open: /research/ /bills/",
  2: "open: /research/ /bills/ /legislators/ /briefings/",
  3: "open: /research/ /bills/ /legislators/ /briefings/ /library/ /topics/",
};

async function current() {
  const { data, error } = await sb.from("site_config").select("crawl_stage, updated_at").eq("id", true).maybeSingle();
  if (error) throw new Error(`read failed: ${error.message} (is migration 0332 applied?)`);
  return { stage: Number(data?.crawl_stage ?? 0), updatedAt: data?.updated_at ?? null };
}

const { stage, updatedAt } = await current();
console.log(`crawl_stage = ${stage}  (${FAMILIES[stage] ?? "?"})${updatedAt ? `  site_config updated ${updatedAt}` : ""}`);
console.log("Never opened by any stage: /alerts /campaigns /forum /meetings /coalitions /intel /academy /partners /profile /i");
if (cmd === "status") process.exit(0);

if (cmd !== "set") { console.error('Usage: crawl-stage.mjs status | set <0-3> --yes [--force]'); process.exit(1); }
const target = Number(argv[1]);
if (!Number.isInteger(target) || target < 0 || target > 3) { console.error("Stage must be 0, 1, 2 or 3."); process.exit(1); }
if (target === stage) { console.log("Already there; nothing to do."); process.exit(0); }

if (target > stage) {
  const truth = await readTrueCredits({ token: process.env.NETLIFY_AUTH_TOKEN, accountSlug: process.env.NETLIFY_ACCOUNT_SLUG || "ohjustadam" });
  const ok = liftAllowed({ truth, force: FORCE });
  console.log(`credit check: ${ok.ok ? "ok" : "REFUSED"} (${ok.reason})`);
  if (!ok.ok) process.exit(2);
}
if (!YES) {
  console.log(`\nWould set crawl_stage ${stage} -> ${target} (${FAMILIES[target]}). Re-run with --yes to apply.`);
  process.exit(0);
}

const { data: rows, error } = await sb.from("site_config").update({ crawl_stage: target }).eq("id", true).select("crawl_stage");
if (error) { console.error(`write failed: ${error.message}`); process.exit(1); }
if (!rows?.length || Number(rows[0].crawl_stage) !== target) { console.error("write touched no row (RLS?). Nothing changed."); process.exit(1); }
console.log(`crawl_stage ${stage} -> ${target}. robots.txt and the sitemap follow within the hour.`);
if (target > stage) {
  console.log('Journal it:  node scripts/session-mesh.mjs say --kind decision "crawl_stage raised to ' + target + ' (<why>)" --as <id>');
  console.log("Watch the next 7 days: Search Console > Crawl stats, `npm run credits`, flood_alarm. Brake: set 0 --yes.");
}
