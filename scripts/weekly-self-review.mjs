#!/usr/bin/env node
/**
 * weekly-self-review.mjs
 *
 * The PROPOSE arm of the self-healing loop.
 *
 * The platform already senses (every job writes scraper_runs), judges
 * (check-cron-staleness against the registry), repairs (retries, provider
 * cooldowns, janitors) and escalates (one push per silent period). What it
 * never did was look at itself over WEEKS and say what should change. This
 * does that once a week, in one Action run, for free.
 *
 * It reads three things and nothing else:
 *   - scraper_runs over the last 14 days — this window against the one before
 *   - admin_audit_log over the window, AGGREGATED BY ACTION NAME ONLY
 *   - the merge history of this checkout (git, no API call, no token)
 * and publishes "what moved, what decayed, what I would do next" as a comment
 * on one rolling GitHub issue. The decision logic lives in lib/self-review.mjs
 * so it can be tested without a database; this file is the IO around it.
 *
 * THE DECAY CLASS THIS EXISTS FOR. The pager can only see a source that stops
 * RUNNING. A job that runs exactly on schedule, exits 0 and returns zero rows
 * every time looks perfectly healthy to it, while its data quietly goes stale.
 * `decay.quiet` is that class. Week-over-week output is the smallest window
 * that can see it, which is why this is weekly and not daily.
 *
 * PUBLIC OUTPUT, SO NO PII. The repo is public, so its Actions logs and its
 * issues are too. The review carries source names, counts and action names. It
 * never carries admin_audit_log.actor_email, actor_id, target_id or the
 * details blob, no user rows of any kind, and every piece of free text is
 * truncated and scrubbed of anything shaped like a credential first.
 *
 * DEGRADES, NEVER LIES. The narrative and the proposals come from the free AI
 * router, and the free pool is regularly exhausted — on 2026-09-17 every one
 * of nine providers returned 429 or 402. When that happens this job still
 * publishes the evidence, says in the review itself that the judgement half
 * could not be written and why, records that in scraper_runs.notes, and exits
 * 0. Reporting success while doing nothing is the failure mode this is written
 * against; so is failing CI because a free vendor was busy.
 *
 * Usage:
 *   node --env-file=.env.local scripts/weekly-self-review.mjs
 *   node --env-file=.env.local scripts/weekly-self-review.mjs --dry-run
 *   node --env-file=.env.local scripts/weekly-self-review.mjs --no-ai --days 14
 *
 * --dry-run  print the review; write no telemetry and publish no comment
 * --no-ai    skip the model call entirely (evidence-only review)
 * --days N   window length in days (default 7; the prior window is the N days
 *            before it)
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { aiRouter, providerNote, logProviderSummary } from "./lib/ai-router.mjs";
import { runWithLogging } from "./lib/scraper-run.mjs";
import { REGISTRY } from "./lib/cron-pager-registry.mjs";
import {
  redact,
  summarise,
  findDecay,
  findMovement,
  parseNarrative,
  renderMarkdown,
} from "./lib/self-review.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const NO_AI = args.includes("--no-ai");
const daysArg = Number(args[args.indexOf("--days") + 1]);
const DAYS = args.includes("--days") && daysArg > 0 ? daysArg : 7;

const MS_DAY = 86_400_000;
const nowMs = Date.now();
const windowStartMs = nowMs - DAYS * MS_DAY;
const priorStartMs = nowMs - 2 * DAYS * MS_DAY;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

// ── 1. telemetry ───────────────────────────────────────────────────────────
// Deliberately small: six columns over 14 days, paged. scraper_runs is the
// table the staleness pager reads every 30 minutes and egress is a hard cap,
// so a weekly review must not become a weekly bandwidth event.
async function readRuns() {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await sb
      .from("scraper_runs")
      .select("source, status, started_at, rows_added, rows_updated, error_message")
      .gte("started_at", new Date(priorStartMs).toISOString())
      .order("started_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`scraper_runs read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) break;
  }
  return rows;
}

// ── 2. what the humans changed ─────────────────────────────────────────────
// Action names and counts only. actor_email, actor_id, target_id and details
// are never selected — this output is public and they are not.
async function readAudit() {
  const { data, error } = await sb
    .from("admin_audit_log")
    .select("action")
    .gte("created_at", new Date(windowStartMs).toISOString())
    .limit(5000);
  if (error) return { total: 0, byAction: [], note: redact(error.message) };
  const counts = new Map();
  for (const r of data ?? []) counts.set(r.action, (counts.get(r.action) ?? 0) + 1);
  return {
    total: data?.length ?? 0,
    byAction: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  };
}

// ── 3. what shipped ────────────────────────────────────────────────────────
// From the checkout rather than the API: no token, no rate limit, works
// locally. Needs fetch-depth: 0 in CI or it sees one commit and reports none.
function readShipped() {
  try {
    const out = execFileSync(
      "git",
      ["log", "--first-parent", `--since=${new Date(windowStartMs).toISOString()}`, "--pretty=format:%s"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 25);
  } catch {
    return [];
  }
}

// ── 4. the judgement half ──────────────────────────────────────────────────
// The router asks every provider for a JSON object (response_format /
// responseMimeType are set per provider) and hands back the parsed result, so
// this asks for fields and renders the markdown itself. That is the safer
// shape anyway: a malformed answer is detectable, and a model cannot smuggle
// headings, links or html into a public issue comment.
const SYSTEM_PROMPT = `You review the weekly operating telemetry of iKratom, a nonpartisan civic-action platform for the kratom advocacy community. It runs on free tiers only: Netlify hosting where every production deploy costs credits, Supabase with a hard bandwidth cap, and GitHub Actions doing the scheduled work.

You are given evidence and nothing else. Rules:
- Use ONLY the numbers in the evidence. Never invent a figure, a source name, a date or an incident.
- If the evidence does not support a claim, do not make it.
- Proposals must be concrete and cheap: something the maintainer could do in one sitting, on a free tier, with no new paid service.
- The maintainer is one non-developer person. Write plain sentences for him, no jargon.

Reply with JSON only, in exactly this shape:
{
  "moved": "two or three sentences on the real activity this week versus last",
  "decayed": "two or three sentences on what got worse or went quiet; say so plainly if nothing did",
  "proposals": [
    { "action": "one sentence naming what to do", "because": "one sentence giving the observation from the evidence that motivates it" }
  ]
}
Give three to five proposals, ordered by value for effort.`;

async function generateNarrative(evidence) {
  const { parsed, provider, elapsedMs } = await aiRouter({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt:
      `Week of ${new Date(windowStartMs).toISOString().slice(0, 10)} to ${new Date(nowMs).toISOString().slice(0, 10)}.\n\n` +
      `EVIDENCE\n${JSON.stringify(evidence, null, 1)}`,
    maxTokens: 1400,
  });
  return { ...parseNarrative(parsed, provider), elapsedMs };
}

// ── 5. publish ─────────────────────────────────────────────────────────────
/**
 * One rolling issue, one comment per week. A fresh issue every week would pile
 * up exactly the way the auto-patch-note PRs did; a comment notifies the
 * maintainer by email, costs nothing, and reads on a phone.
 */
const MARKER = "<!-- ikratom:weekly-self-review -->";

async function publishToIssue(body) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return { published: false, reason: "no GITHUB_TOKEN/GITHUB_REPOSITORY" };

  const api = async (path, init = {}) => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub ${init.method ?? "GET"} ${path} -> ${res.status} ${redact(await res.text())}`);
    }
    return res.json();
  };

  // Paged, because /issues returns pull requests too and this repo carries a
  // dozen open PRs at a time. One unpaged page would eventually stop finding
  // the rolling issue and silently start a second one every week.
  let issue = null;
  for (let page = 1; page <= 3 && !issue; page++) {
    const batch = await api(`/issues?state=open&per_page=100&page=${page}`);
    if (!batch?.length) break;
    issue = batch.find((i) => !i.pull_request && typeof i.body === "string" && i.body.includes(MARKER)) ?? null;
    if (batch.length < 100) break;
  }

  if (!issue) {
    issue = await api("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: "Weekly self-review",
        body:
          `${MARKER}\nThe platform's own weekly review of what moved, what decayed, and what it would do next.\n\n` +
          "Written every Sunday by `scripts/weekly-self-review.mjs` from `scraper_runs`, `admin_audit_log` and this " +
          "repo's merge history. Each week lands as a comment below.\n\n" +
          "Nothing here is acted on automatically — the proposals are yours to take or ignore. Close this issue and " +
          "the job opens a fresh one next week.",
      }),
    });
  }

  await api(`/issues/${issue.number}/comments`, { method: "POST", body: JSON.stringify({ body }) });
  return { published: true, number: issue.number, url: issue.html_url };
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Weekly self-review — ${DAYS}d window from ${new Date(windowStartMs).toISOString()}`);
  if (!NO_AI) logProviderSummary("Self-review AI pool");

  const runs = await readRuns();
  const { cur, prev } = summarise(runs, { windowStartMs });
  const movement = findMovement(cur, prev);
  const decay = findDecay(cur, prev, { registry: REGISTRY, windowDays: DAYS });
  const audit = await readAudit();
  const shipped = readShipped();
  const signals =
    decay.failing.length + decay.quiet.length + decay.silent.length +
    decay.shrinking.length + decay.unregistered.length;
  console.log(
    `  ${runs.length} runs across ${cur.size} sources · ${decay.failing.length} failing · ` +
      `${decay.quiet.length} quietly empty · ${decay.silent.length} silent · ${shipped.length} merges`,
  );

  const evidence = { window_days: DAYS, movement, decay, admin_actions: audit, merged_to_main: shipped };

  let narrative = null;
  let degraded = null;
  if (NO_AI) {
    degraded = "skipped (--no-ai)";
  } else {
    try {
      narrative = await generateNarrative(evidence);
      console.log(`  narrative via ${narrative.provider} in ${narrative.elapsedMs}ms`);
    } catch (e) {
      // THE DEGRADE PATH. Every free provider being busy is a normal Sunday,
      // not an incident. Publish the evidence, say the judgement is missing,
      // exit 0.
      degraded = redact(e?.message ?? e);
      console.log(`  ⚠ narrative unavailable: ${degraded}`);
    }
  }

  const body = renderMarkdown({ evidence, narrative, degraded, windowStartMs, nowMs });

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  console.log(`\n${body}\n`);

  if (DRY) {
    console.log("--dry-run: not publishing, not writing telemetry");
    return { rowsAdded: 0, rowsUpdated: 0 };
  }

  // A REFUSED WRITE IS NOT A DEGRADE, and the two must not be confused.
  //
  // The AI half degrades quietly on purpose: a busy free vendor is a normal
  // Sunday, and the evidence still reaches the job summary either way. A
  // publish that fails is the opposite — the review reaches NOBODY, and a run
  // that then exits 0 is the exact shape of failure this repo loses for weeks.
  // A missing `issues: write`, a token whose scope changed, an API outage: all
  // of them look like a clean green weekly job while nothing has been said to
  // anyone since. So this throws. runWithLogging records status 'error' with
  // the reason and the run goes red, where the next person to look will see it.
  //
  // The one non-fatal case is having no token at all, which only happens
  // outside Actions — a local run, where the operator is reading stdout and
  // the review is already on it.
  const published = await publishToIssue(body);
  console.log(published.published ? `  published to issue #${published.number}` : `  not published: ${published.reason}`);

  const notes = [
    `${cur.size} sources, ${movement.totals.runs} runs`,
    `${signals} decay signals`,
    degraded ? `narrative degraded: ${degraded}` : `narrative via ${narrative.provider}`,
    published.published ? `issue #${published.number}` : `unpublished: ${published.reason}`,
    NO_AI ? null : providerNote(),
  ]
    .filter(Boolean)
    .join(" · ");

  // rowsUpdated is the count of decay signals, so scraper_runs distinguishes a
  // run that reviewed a quiet week from one that found real problems.
  return { rowsAdded: published.published ? 1 : 0, rowsUpdated: signals, notes: notes.slice(0, 500) };
}

if (DRY) {
  await main();
} else {
  await runWithLogging({ source: "weekly_self_review", supabase: sb }, main);
}
