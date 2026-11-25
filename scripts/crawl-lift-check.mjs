#!/usr/bin/env node
/**
 * crawl-lift-check.mjs — is each family safe to open to crawlers? Run it BEFORE
 * raising `site_config.crawl_stage` (scripts/crawl-stage.mjs).
 *
 * For every family the target stage would open, it fetches 3 real URLs from the
 * Netlify ORIGIN (no Cloudflare cache in between, so each is a COLD render, the
 * cost a crawler pays), one every 2 seconds, and reports status, full-body time
 * and a few failure markers. It only reads; a cold render is about a second of
 * function time, a few thousandths of a credit.
 *
 *   node --env-file=.env.local scripts/crawl-lift-check.mjs                 # the next stage
 *   node --env-file=.env.local scripts/crawl-lift-check.mjs --stage 2       # stages 1..2
 *   node --env-file=.env.local scripts/crawl-lift-check.mjs --origin https://<draft>.netlify.app
 *
 * Verdict per family: OK when all three answer 200 within 2.5 s and show a
 * title; HOLD otherwise. It times the full body, so the TTFB trap from the
 * 2026-11-10 render work does not apply. Default origin: the published production
 * deploy's direct URL (the site's own netlify.app address redirects to www).
 */
import { createClient } from "@supabase/supabase-js";
import { readdirSync } from "node:fs";
import { browserUA } from "./lib/browser-ua.mjs";

const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
// The site's own *.netlify.app address answers 308 to www (netlify.toml), which reads as HOLD for every family
// and measures nothing. The published production deploy's URL serves directly, so the render is cold and real.
// Another host: pass --origin <its direct URL>, or set CRON_ORIGIN (docs/RUNBOOK_host_move.md).
async function resolveOrigin() {
  if (arg("origin")) return arg("origin");
  const t = process.env.NETLIFY_AUTH_TOKEN, id = process.env.NETLIFY_SITE_ID;
  if (t && id) {
    try {
      const r = await fetch(`https://api.netlify.com/api/v1/sites/${id}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
      const u = (await r.json())?.published_deploy?.deploy_ssl_url;
      if (u) return u;
    } catch { /* fall through to the next source */ }
  }
  return process.env.CRON_ORIGIN || "https://ikratom.netlify.app";
}
const ORIGIN = (await resolveOrigin()).replace(/\/$/, "");
const MAX_SECONDS = 2.5;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const STAGES = { 1: ["/research/", "/bills/"], 2: ["/legislators/", "/briefings/"], 3: ["/library/", "/topics/"] };
const { data: cfg } = await sb.from("site_config").select("crawl_stage").eq("id", true).maybeSingle();
const now = Number(cfg?.crawl_stage ?? 0);
const target = Number(arg("stage") ?? Math.min(3, now + 1));
const families = [1, 2, 3].filter((n) => n <= target && n > (arg("stage") ? 0 : now)).flatMap((n) => STAGES[n]);
if (!families.length) { console.log(`Nothing to check (crawl_stage ${now}, target ${target}).`); process.exit(0); }

const pick3 = (rows) => {
  if (rows.length <= 3) return rows;
  const step = Math.floor(rows.length / 3);
  return [rows[0], rows[step], rows[2 * step]];
};
const ids = async (table, col, filter) => {
  let q = sb.from(table).select(col).limit(60);
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
  const { data } = await q;
  return pick3((data ?? []).map((r) => r[col]));
};

const samplers = {
  "/bills/": () => ids("bills", "id", { active: true }),
  "/research/": () => ids("research_papers", "id", { is_active: true }),
  "/legislators/": () => ids("legislators", "id", { active: true }),
  "/library/": () => ids("library_items", "id", { active: true }),
  // The topic slugs are a fixed list (src/app/topics/[topic]); the heaviest three are sampled.
  "/topics/": async () => ["kratom", "cannabis", "hemp_cbd"],
  "/briefings/": async () => pick3(readdirSync("src/content/briefings").filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function timeIt(path) {
  const t = performance.now();
  try {
    const r = await fetch(`${ORIGIN}${path}?cb=${Math.random().toString(36).slice(2)}`, {
      headers: { "user-agent": browserUA(), "accept-encoding": "br, gzip" }, redirect: "manual", signal: AbortSignal.timeout(40_000),
    });
    const body = await r.text();
    const sec = (performance.now() - t) / 1000;
    const bad = [];
    if (r.status !== 200) bad.push(`HTTP ${r.status}${[301, 302, 307, 308].includes(r.status) ? ` to ${r.headers.get("location") ?? "?"} (this origin redirects instead of serving: pass --origin <direct deploy URL>)` : ""}`);
    if (!/<title[^>]*>[^<]+/i.test(body)) bad.push("no title");
    if (/Application error|This page couldn.t load|Internal Server Error/i.test(body)) bad.push("error text");
    if (sec > MAX_SECONDS) bad.push(`slow ${sec.toFixed(1)}s`);
    return { path, sec, bad };
  } catch (e) {
    return { path, sec: (performance.now() - t) / 1000, bad: [`fetch failed: ${e.message}`] };
  }
}

console.log(`origin ${ORIGIN}; crawl_stage now ${now}; checking ${families.join(" ")}\n`);
let hold = 0;
for (const fam of families) {
  const sample = samplers[fam] ? await samplers[fam]() : [];
  if (!sample.length) { console.log(`${fam.padEnd(15)} NO SAMPLE (${samplers[fam] ? "no rows" : "no sampler: open one by hand"})`); hold++; continue; }
  const out = [];
  for (const id of sample) { out.push(await timeIt(`${fam}${id}`)); await sleep(2000); }
  const bad = out.flatMap((o) => o.bad.map((b) => `${o.path}: ${b}`));
  console.log(`${fam.padEnd(15)} ${bad.length ? "HOLD" : "OK  "}  ${out.map((o) => `${o.sec.toFixed(1)}s`).join("  ")}`);
  for (const b of bad) console.log(`    ${b}`);
  if (bad.length) hold++;
}
console.log(hold ? `\n${hold} family(ies) on HOLD. Fix them (or leave them blocked) before raising the stage.` : "\nAll checked families are OK to open. Raise with scripts/crawl-stage.mjs set <n> --yes.");
process.exit(hold ? 3 : 0);
