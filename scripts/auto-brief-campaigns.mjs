#!/usr/bin/env node
/**
 * auto-brief-campaigns.mjs — Hermes nightly auto-brief (PR-E).
 *
 * Every newly auto-approved campaign gets a research briefing written by the
 * LOCAL tool-calling agent (scripts/research-campaign.mjs, hermes3:8b —
 * pulled + smoke-tested 2026-06-09: loads in ~11s, fits in RAM beside
 * Docker, emits correct tool_calls). The agent searches news/bills/
 * legislators via its tools and writes campaigns.briefing — deep-dives run
 * on the box, not on Claude usage. This wrapper is the batch chassis; the
 * tool belt grows toward the Dossier research engine from here.
 *
 * Each campaign runs in a CHILD PROCESS so one hung/failed brief can't
 * take down the batch.
 *
 * 2026-09-07 — NO LONGER BOX-ONLY. This used to open with a reachability
 * probe and, if Ollama was missing, print "nothing to do here (the box drains
 * the queue)" and exit 0 WITHOUT writing telemetry. On the owner's PC that is
 * a graceful skip; anywhere else it silently meant the feature did not exist,
 * and the staleness watchdog read the silence as "never ran" rather than
 * "could not run". The box had not run it in 55 days.
 *
 * research-campaign.mjs now drives lib/tool-chat.mjs, which speaks the same
 * tool-calling loop to Ollama OR to any free OpenAI-compatible provider, so
 * this runs anywhere. Local Ollama is still preferred when it is up: it is
 * free and unmetered. Telemetry is written on EVERY exit path, including the
 * no-provider one, which is now an explicit error rather than silence.
 *
 *   node --env-file=.env.local scripts/auto-brief-campaigns.mjs --limit 3
 *   node --env-file=.env.local scripts/auto-brief-campaigns.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { ollamaToolModel, availableToolProviders } from "./lib/tool-chat.mjs";

// No MODEL constant: lib/tool-chat picks the provider and model (local Ollama
// first, free cloud after), and research-campaign reports which one wrote each
// briefing.
const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const num = (v, dflt) => { const n = parseInt(v ?? "", 10); return Number.isFinite(n) && n > 0 ? n : dflt; };
const LIMIT = num(arg("--limit"), 3);
const DRY = args.includes("--dry-run");
const PER_CAMPAIGN_TIMEOUT_MS = 10 * 60_000; // hermes is ~1-3 min/brief; 10m is a hang guard

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const t0 = Date.now();
const NOW = () => new Date().toISOString();

// Telemetry on every exit path. The old early-exit wrote none at all, so a
// run that COULD NOT work was indistinguishable from one that never fired.
async function record(status, notes, rows = 0) {
  try {
    await sb.from("scraper_runs").insert({
      source: "auto_brief_campaigns",
      started_at: new Date(t0).toISOString(),
      finished_at: NOW(),
      status,
      rows_updated: rows,
      notes,
    });
  } catch { /* best-effort */ }
}

// Prefer local Ollama (free, unmetered); fall through to the free cloud
// providers. Only a total absence of both is a real failure.
const localModel = await ollamaToolModel();
const cloudProviders = availableToolProviders();
if (!localModel && cloudProviders.length === 0) {
  console.error("auto-brief: no tool-capable provider — Ollama is not up and no free-tier key is set.");
  await record("error", "no tool-capable provider (no Ollama, no free-tier key) — briefings could not run");
  process.exit(1);
}
console.log(`auto-brief: local:${localModel ?? "none"} cloud:[${cloudProviders.join(", ") || "none"}]`);

// Newest unbriefed active campaigns first — auto-approved ones land here the
// hour they flip active, so "newly approved" is the natural front of queue.
const { data: rows, error } = await sb
  .from("campaigns")
  .select("id, slug, title, state, created_at")
  .eq("active", true)
  .is("briefing", null)
  .order("created_at", { ascending: false })
  .limit(LIMIT);
if (error) { console.error(error.message); process.exit(1); }

console.log(`auto-brief: ${rows?.length ?? 0} unbriefed active campaign(s)${DRY ? " [DRY]" : ""}\n`);

let briefed = 0, failed = 0;
for (const c of rows ?? []) {
  const tag = `[${c.state ?? "US"}] ${c.slug}`;
  if (DRY) { console.log(`  · would brief ${tag}`); continue; }
  console.log(`  ▶ ${tag}`);
  // --model names the LOCAL model and only matters when Ollama is up; without
  // it research-campaign picks a cloud provider on its own.
  const childArgs = ["scripts/research-campaign.mjs", "--id", c.id];
  if (localModel) childArgs.push("--model", localModel);
  const r = spawnSync(process.execPath, childArgs, {
    env: process.env,
    timeout: PER_CAMPAIGN_TIMEOUT_MS,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status === 0) {
    briefed++;
    console.log(`  ✓ briefed ${tag}`);
  } else {
    failed++;
    const reason = r.error?.message ?? (r.signal ? `signal ${r.signal} (timeout?)` : `exit ${r.status}`);
    console.log(`  ✗ ${tag}: ${reason}`);
    const tail = (r.stdout ?? "").split("\n").filter(Boolean).slice(-3).join(" | ");
    if (tail) console.log(`    ${tail.slice(0, 200)}`);
  }
}

console.log(`\nDone. briefed=${briefed} failed=${failed}`);
await record(
  failed > 0 && briefed === 0 ? "fail" : briefed > 0 ? "success" : "empty",
  `briefed=${briefed} failed=${failed} local=${localModel ?? "none"} cloud=${cloudProviders.length}${DRY ? " [dry-run]" : ""}`,
  briefed,
);
process.exit(0);
