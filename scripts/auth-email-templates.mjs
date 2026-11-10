#!/usr/bin/env node
/**
 * Check or apply iKratom's Supabase Auth email templates
 * (scripts/lib/auth-email-templates.mjs explains why they exist).
 *
 *   node --env-file=.env.local scripts/auth-email-templates.mjs            # dry run: what differs
 *   node --env-file=.env.local scripts/auth-email-templates.mjs --check    # exit 1 on drift
 *   node --env-file=.env.local scripts/auth-email-templates.mjs --apply    # write ours, then re-read
 *   node --env-file=.env.local scripts/auth-email-templates.mjs --rollback # Supabase's defaults
 *
 * Needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (Management API).
 */
import { DESIRED, SUPABASE_DEFAULTS, templateDrift } from "./lib/auth-email-templates.mjs";

const args = new Set(process.argv.slice(2));
const ref = process.env.SUPABASE_PROJECT_REF;
// The repo secret copy starts with a byte-order mark, which fetch() refuses in
// a header (STATE_OF_PLAY "Things that will bite you").
const token = process.env.SUPABASE_ACCESS_TOKEN?.replace(/^﻿/, "").trim();
if (!ref || !token) {
  console.error("Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN.");
  process.exit(2);
}
const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function readLive() {
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`GET config/auth ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// Returns the exit code. Never process.exit() straight after a fetch: on
// Windows that trips a libuv assertion and the process dies with 127.
async function main() {
  const live = await readLive();
  const want = args.has("--rollback") ? SUPABASE_DEFAULTS : DESIRED;

  if (!live.smtp_host) {
    console.error("Custom SMTP is off, so Supabase ignores template edits. Set Auth SMTP first.");
    return 1;
  }

  const drift = templateDrift(live, want);
  console.log(drift.length ? `Differs: ${drift.join(", ")}` : "Live templates match.");

  if (args.has("--check")) return drift.length ? 1 : 0;
  if (!args.has("--apply") && !args.has("--rollback")) {
    if (drift.length) console.log("Dry run. Pass --apply to write them.");
    return 0;
  }
  if (!drift.length) return 0;

  const body = Object.fromEntries(drift.map((k) => [k, want[k]]));
  const r = await fetch(url, { method: "PATCH", headers, body: JSON.stringify(body) });
  if (!r.ok) {
    console.error(`PATCH failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return 1;
  }
  const after = templateDrift(await readLive(), want);
  if (after.length) {
    console.error(`Wrote, but these still differ: ${after.join(", ")}`);
    return 1;
  }
  console.log(`Wrote ${drift.length} field(s); re-read matches.`);
  return 0;
}

process.exitCode = await main();
