/**
 * diagnose-cron-sources.mjs — why is each cron source silent?
 *
 * The pager reports "40 sources stale >48h" and stops there, which is the least
 * useful possible answer: it cannot tell a DEAD JOB (real outage, users losing
 * data) from a PHANTOM (registered but nothing on earth writes it, so it can
 * never clear and the pager cries wolf forever). Both show up identically, and
 * a pager that cries wolf is how the fire-waves outage went unnoticed for 24
 * days.
 *
 * This classifies every registered source mechanically:
 *
 *   PHANTOM      no script writes this source string at all. The registry is
 *                watching for a signal that has no emitter. Fix the registry
 *                or give the script a writer.
 *   ORPHANED     a script writes it, but no workflow or box runner invokes
 *                that script. Nothing schedules it, so of course it is silent.
 *   BOX-ONLY     runs solely from run-nightly-steps.cmd on the owner's PC.
 *                Silent whenever that machine is off — expected, not a fault.
 *   SCHEDULED    a workflow does invoke it, so silence is a REAL failure and
 *                the run logs are worth reading.
 *   FRESH        wrote within its expected window.
 *
 * Read-only. Writes nothing, fixes nothing — it tells you which of the four
 * problems you actually have, which is the part that costs judgment.
 *
 * Usage:
 *   node --env-file=.env.local scripts/diagnose-cron-sources.mjs
 *   node --env-file=.env.local scripts/diagnose-cron-sources.mjs --json
 */
import { createClient } from "@supabase/supabase-js";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY } from "./lib/cron-pager-registry.mjs";

const JSON_OUT = process.argv.includes("--json");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");
const WORKFLOWS = join(ROOT, ".github", "workflows");

/**
 * Every candidate WRITER body, so we can ask "who writes this source string?"
 *
 * Covers scripts/*.mjs AND src/app/api/cron/-star-/route.ts. Scanning only
 * scripts/ produced a false PHANTOM on the first run: `reverify_local_officials`
 * is written by the API route, not a script, and the tool confidently reported
 * that nothing on earth wrote it. A diagnostic that invents faults is worse
 * than no diagnostic — it sends you hunting a bug that does not exist.
 */
function loadScripts() {
  const out = new Map();
  for (const f of readdirSync(SCRIPTS)) {
    if (!f.endsWith(".mjs")) continue;
    try {
      out.set(f, readFileSync(join(SCRIPTS, f), "utf8"));
    } catch { /* unreadable — skip */ }
  }
  // API cron routes are writers too.
  const apiCron = join(ROOT, "src", "app", "api", "cron");
  if (existsSync(apiCron)) {
    for (const dir of readdirSync(apiCron)) {
      const route = join(apiCron, dir, "route.ts");
      if (!existsSync(route)) continue;
      try {
        out.set(`api/cron/${dir}/route.ts`, readFileSync(route, "utf8"));
      } catch { /* skip */ }
    }
  }
  return out;
}

/** Every workflow body + the box runner, so we can ask "who invokes this?" */
function loadInvokers() {
  const out = new Map();
  if (existsSync(WORKFLOWS)) {
    for (const f of readdirSync(WORKFLOWS)) {
      if (!/\.ya?ml$/.test(f)) continue;
      try {
        out.set(f, readFileSync(join(WORKFLOWS, f), "utf8"));
      } catch { /* skip */ }
    }
  }
  for (const box of ["run-nightly-steps.cmd", join("scripts", "run-nightly-steps.cmd")]) {
    const p = join(ROOT, box);
    if (existsSync(p)) {
      try { out.set("run-nightly-steps.cmd", readFileSync(p, "utf8")); } catch { /* skip */ }
    }
  }
  return out;
}

async function main() {
  const scripts = loadScripts();
  const invokers = loadInvokers();

  // Newest run per source. scraper_runs_latest is a view that already does the
  // DISTINCT ON, which keeps this to one round-trip instead of 95.
  const { data: latest, error } = await sb
    .from("scraper_runs_latest")
    .select("source, finished_at, status")
    .limit(2000);
  if (error) throw error;
  const lastBySource = new Map((latest ?? []).map((r) => [r.source, r]));

  const now = Date.now();
  const findings = [];

  for (const entry of REGISTRY) {
    const src = entry.source;
    const last = lastBySource.get(src);
    const ageH = last?.finished_at
      ? (now - new Date(last.finished_at).getTime()) / 3_600_000
      : null;
    const threshold = (entry.interval_hours ?? 24) * 3;
    const stale = ageH === null || ageH > threshold;

    if (!stale) {
      findings.push({ source: src, verdict: "FRESH", ageH: Math.round(ageH), system: entry.system });
      continue;
    }

    // Who writes this source string? Quoted match only — a bare substring
    // would match prose in a comment and invent a writer that isn't one.
    const writers = [...scripts.entries()]
      .filter(([f, body]) =>
        f !== "cron-pager-registry.mjs" &&
        f !== "diagnose-cron-sources.mjs" && // this file quotes every source name
        (body.includes(`"${src}"`) || body.includes(`'${src}'`) || body.includes(`\`${src}\``)))
      .map(([f]) => f);

    if (writers.length === 0) {
      findings.push({ source: src, verdict: "PHANTOM", ageH: ageH === null ? null : Math.round(ageH), system: entry.system, writers: [], invokers: [] });
      continue;
    }

    // Match how each writer is actually invoked. Scripts are invoked by
    // FILENAME (`node scripts/foo.mjs`); API cron routes are invoked by URL
    // (`curl $APP_URL/api/cron/foo`), so filename matching alone reported a
    // live, scheduled endpoint as ORPHANED — the second false verdict this
    // tool produced. Check the endpoint path for those.
    const invokedBy = [...invokers.entries()]
      .filter(([, body]) =>
        writers.some((w) => {
          const apiRoute = w.match(/^api\/cron\/([^/]+)\/route\.ts$/);
          return apiRoute ? body.includes(`api/cron/${apiRoute[1]}`) : body.includes(w);
        }))
      .map(([f]) => f);

    let verdict;
    if (invokedBy.length === 0) verdict = "ORPHANED";
    else if (invokedBy.every((f) => f === "run-nightly-steps.cmd")) verdict = "BOX-ONLY";
    else verdict = "SCHEDULED";

    findings.push({
      source: src,
      verdict,
      ageH: ageH === null ? null : Math.round(ageH),
      system: entry.system,
      writers,
      invokers: invokedBy,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(findings, null, 2));
    return;
  }

  const order = ["SCHEDULED", "PHANTOM", "ORPHANED", "BOX-ONLY", "FRESH"];
  const blurb = {
    SCHEDULED: "a workflow DOES run these — silence is a real failure, read the run logs",
    PHANTOM: "nothing writes this source string; the registry watches a signal with no emitter",
    ORPHANED: "a script writes it but nothing schedules that script",
    "BOX-ONLY": "only runs from the owner's PC — silent when it is off, expected",
    FRESH: "healthy",
  };

  console.log(`\n== cron source diagnosis — ${REGISTRY.length} registered ==\n`);
  for (const v of order) {
    const rows = findings.filter((f) => f.verdict === v);
    if (rows.length === 0) continue;
    console.log(`${v}  (${rows.length}) — ${blurb[v]}`);
    if (v === "FRESH") { console.log(""); continue; }
    for (const r of rows.sort((a, b) => (b.ageH ?? 1e9) - (a.ageH ?? 1e9))) {
      const age = r.ageH === null ? "never run" : `${r.ageH}h`;
      console.log(`   ${r.source.padEnd(38)} ${age.padStart(10)}  ${r.writers?.length ? r.writers.join(", ") : "(no writer)"}`);
      if (r.invokers?.length) console.log(`   ${" ".repeat(38)}             via ${r.invokers.join(", ")}`);
    }
    console.log("");
  }

  const counts = Object.fromEntries(order.map((v) => [v, findings.filter((f) => f.verdict === v).length]));
  console.log("summary:", JSON.stringify(counts));
  console.log("\nACT ON 'SCHEDULED' FIRST — those are the only ones that are genuinely broken.\n");
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
