#!/usr/bin/env node
/**
 * check-security-advisors.mjs — the weekly read of Supabase's security advisor.
 *
 * Comparing it to the baseline was a manual step, so it only happened when a
 * session remembered. This fails the run and tells the owner when the count
 * rises or a new kind of finding appears (baseline: scripts/lib/advisor-baseline.mjs).
 *
 * Output stays at counts: workflow logs on this repo are public and
 * scraper_runs notes can be read by visitors, and a new finding is a weakness
 * until someone looks at it. The names go only to the owner's phone and inbox.
 *
 *   node --env-file=.env.local scripts/check-security-advisors.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { BASELINE_TOTAL, judgeAdvisors } from "./lib/advisor-baseline.mjs";
import { alertOwner } from "./lib/owner-alert.mjs";

const SOURCE = "check_security_advisors";
const startedAt = new Date().toISOString();
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || "").replace(/^﻿/, "");
const REF = process.env.SUPABASE_PROJECT_REF || new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN not set"); process.exit(2); }

const sb = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/advisors/security`, {
  headers: { Authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(60_000),
});
const body = await r.json().catch(() => ({}));
const lints = Array.isArray(body.lints) ? body.lints : [];
const verdict = judgeAdvisors(lints);
const readFailed = !r.ok || verdict.readNothing;

const summary = readFailed
  ? `could not read the advisor (HTTP ${r.status})`
  : `${verdict.total} findings against a baseline of ${BASELINE_TOTAL}, ${verdict.newTypes.length} new kind(s)`;
console.log(summary);

if (!verdict.ok) {
  const details = verdict.newTypes.map((n) => {
    const hit = lints.filter((l) => l.name === n);
    return `${n} (${hit[0].level}, ${hit.length}): ${hit[0].title ?? ""}`;
  });
  await alertOwner({
    title: "Supabase security advisor changed",
    body: [summary, ...details, "Ask a session to review it. Don't post this anywhere public."].join("\n"),
    priority: "high",
    tags: ["warning"],
    sb,
  });
}

await sb?.from("scraper_runs").insert({
  source: SOURCE, started_at: startedAt, finished_at: new Date().toISOString(),
  status: verdict.ok ? "success" : "error", rows_updated: 0, notes: summary,
});
process.exitCode = verdict.ok ? 0 : 1;
