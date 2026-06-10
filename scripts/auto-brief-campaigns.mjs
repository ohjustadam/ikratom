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
 * take down the batch. Skips cleanly when Ollama or the model is missing
 * (cloud runners). Telemetry: scraper_runs source auto_brief_campaigns
 * (registered in check-cron-staleness as local-box).
 *
 *   node --env-file=.env.local scripts/auto-brief-campaigns.mjs --limit 3
 *   node --env-file=.env.local scripts/auto-brief-campaigns.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const MODEL = "hermes3:8b";
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

// Ollama + model must be reachable HERE (the box). Anywhere else: clean no-op.
async function hermesAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return false;
    const models = ((await res.json()).models ?? []).map((m) => m.name);
    return models.some((m) => m === MODEL || m.startsWith(MODEL.split(":")[0]));
  } catch {
    return false;
  }
}

if (!(await hermesAvailable())) {
  console.log(`auto-brief: Ollama/${MODEL} not reachable at ${OLLAMA_URL} — nothing to do here (the box drains the queue).`);
  process.exit(0);
}

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
  const r = spawnSync(process.execPath, ["scripts/research-campaign.mjs", "--id", c.id, "--model", MODEL], {
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
try {
  await sb.from("scraper_runs").insert({
    source: "auto_brief_campaigns",
    started_at: new Date(t0).toISOString(),
    finished_at: NOW(),
    status: failed > 0 && briefed === 0 ? "fail" : "success",
    rows_updated: briefed,
    notes: `briefed=${briefed} failed=${failed} model=${MODEL}${DRY ? " [dry-run]" : ""}`,
  });
} catch { /* best-effort */ }
process.exit(0);
