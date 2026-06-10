#!/usr/bin/env node
/**
 * generate-state-snapshot.mjs — nightly platform-state brief (PR-F,
 * Claude-burn killer #2). One markdown page with the live queue depths,
 * cron health, ledger stats, and open PRs, so a Claude session cold-starts
 * from a fresh snapshot instead of spending tokens re-deriving state.
 *
 *   node --env-file=.env.local scripts/generate-state-snapshot.mjs --out private/session-prep/STATE_SNAPSHOT.md
 */
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const argOf = (f) => { const i = args.indexOf(f); const v = args[i + 1]; return i >= 0 && v && !v.startsWith("--") ? v : null; };
const OUT = argOf("--out") ?? "private/session-prep/STATE_SNAPSHOT.md";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const count = async (table, mod = (q) => q) => {
  try {
    const { count: c, error } = await mod(sb.from(table).select("*", { count: "exact", head: true }));
    return error ? `err: ${error.message.slice(0, 60)}` : (c ?? 0);
  } catch (e) { return `err: ${e.message.slice(0, 60)}`; }
};

const [
  pendingReps, fulfilledReps,
  intelQueued, intelSwept,
  bansHeld, bansConfirmed, bansRepealed,
  campaignsActive, campaignsPending, campaignsUnbriefed,
  notifsUnpushed,
] = await Promise.all([
  count("local_rep_requests", (q) => q.eq("status", "pending")),
  count("local_rep_requests", (q) => q.eq("status", "fulfilled")),
  count("locality_intel", (q) => q.eq("sweep_status", "queued")),
  count("locality_intel", (q) => q.eq("sweep_status", "swept")),
  count("bills", (q) => q.in("scope", ["county", "municipal"]).in("verification_status", ["single_source", "unverified"])),
  count("bills", (q) => q.in("scope", ["county", "municipal"]).eq("verification_status", "confirmed")),
  count("bills", (q) => q.in("scope", ["county", "municipal"]).eq("verification_status", "repealed")),
  count("campaigns", (q) => q.eq("active", true)),
  count("campaigns", (q) => q.eq("active", false)),
  count("campaigns", (q) => q.eq("active", true).is("briefing", null)),
  count("notifications", (q) => q.is("pushed_at", null).gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString())),
]);

// Cron health: latest run per source, flag anything that looks unhappy.
let cronLines = [];
try {
  const { data } = await sb.from("scraper_runs_latest")
    .select("source, finished_at, status, rows_updated, rows_added")
    .order("finished_at", { ascending: false })
    .limit(60);
  for (const r of data ?? []) {
    const age = Math.round((Date.now() - new Date(r.finished_at).getTime()) / 36e5);
    const flag = r.status !== "success" ? " ⚠" : age > 48 ? " (stale)" : "";
    cronLines.push(`- ${r.source}: ${r.status}, ${age}h ago${flag}`);
  }
} catch (e) { cronLines = [`- err: ${e.message.slice(0, 80)}`]; }

// Open PRs via gh (best-effort — gh lives on the box).
let prLines = [];
try {
  const raw = execSync("gh pr list --json number,title,headRefName --limit 20", { encoding: "utf8", timeout: 30_000 });
  prLines = JSON.parse(raw).map((p) => `- #${p.number} ${p.title} (${p.headRefName})`);
  if (prLines.length === 0) prLines = ["- none"];
} catch { prLines = ["- (gh unavailable)"]; }

const md = `# State snapshot — generated ${new Date().toISOString().slice(0, 16)}Z

Regenerated nightly by scripts/generate-state-snapshot.mjs (run-nightly step 6).

## Queues
- local rep requests: ${pendingReps} pending · ${fulfilledReps} fulfilled all-time
- locality intel: ${intelQueued} queued · ${intelSwept} swept
- local bans: ${bansHeld} held · ${bansConfirmed} confirmed · ${bansRepealed} repealed
- campaigns: ${campaignsActive} active (${campaignsUnbriefed} unbriefed) · ${campaignsPending} inactive
- notifications unpushed (7d): ${notifsUnpushed}

## Cron health (latest run per source)
${cronLines.join("\n")}

## Open PRs
${prLines.join("\n")}
`;

mkdirSync(dirname(resolve(process.cwd(), OUT)), { recursive: true });
writeFileSync(resolve(process.cwd(), OUT), md);
console.log(`✓ wrote ${OUT}`);

try {
  await sb.from("scraper_runs").insert({
    source: "session_prep",
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    status: "success",
    rows_updated: 1,
    notes: `snapshot + codebase map regenerated`,
  });
} catch { /* best-effort */ }
