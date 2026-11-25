/**
 * Signup-surge switches on Supabase Auth: check, then the one switch that
 * takes confirmation email out of the signup path. docs/RUNBOOK_surge.md says when.
 *
 *   node --env-file=.env.local scripts/auth-surge.mjs                  # status (read-only)
 *   node --env-file=.env.local scripts/auth-surge.mjs autoconfirm-on   # PRODUCTION: owner yes first
 *   node --env-file=.env.local scripts/auth-surge.mjs autoconfirm-off  # undo
 *
 * Autoconfirm: a new member is signed in at once and no confirmation email
 * goes out, so the 30-an-hour auth email cap and Resend's 100 a day stop
 * mattering. The cost: addresses are no longer proven, so typos and throwaway
 * accounts get in. Undo it once the rush is over.
 *
 * ORDER MATTERS. With autoconfirm on, sign-up answers with a session. Only the
 * signup form from #1174 on knows to go straight in. An older live build tells
 * the new member to check an email that never comes. So `autoconfirm-on`
 * refuses unless the live signup page carries that code (--force skips the
 * check; don't).
 *
 * Captcha has its own switch: scripts/auth-captcha.mjs. Auth SMTP and the
 * hourly email cap: scripts/configure-auth-smtp.mjs. Needs SUPABASE_ACCESS_TOKEN
 * + SUPABASE_PROJECT_REF; status also reads the queue with the service role.
 */
import { createClient } from "@supabase/supabase-js";

const cmd = process.argv[2] ?? "status";
const force = process.argv.includes("--force");
const SITE = (process.env.SURGE_CHECK_URL ?? "https://www.ikratom.org").replace(/\/$/, "");
// Text that ships only with the #1174 signup form (SIGNUP_QUEUED_MESSAGE).
const MARKER = "your confirmation email is in a queue";
const env = (k) => (process.env[k] ?? "").replace(/^﻿/, "").trim().replace(/^"|"$/g, "");
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

const ref = env("SUPABASE_PROJECT_REF");
const mgmt = env("SUPABASE_ACCESS_TOKEN");
async function authConfig(patch) {
  if (!ref || !mgmt) die("Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN.");
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    method: patch ? "PATCH" : "GET",
    headers: { Authorization: `Bearer ${mgmt}`, "Content-Type": "application/json" },
    body: patch ? JSON.stringify(patch) : undefined,
  });
  if (!r.ok) die(`${patch ? "PATCH" : "GET"} auth config → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
function printConfig(c) {
  console.log(`  mailer_autoconfirm:       ${c.mailer_autoconfirm}`);
  console.log(`  rate_limit_email_sent:    ${c.rate_limit_email_sent} an hour`);
  console.log(`  smtp_host:                ${c.smtp_host ?? "(built-in, 2 an hour)"}`);
  console.log(`  security_captcha_enabled: ${c.security_captcha_enabled}`);
}

/** True when the live /signup page loads the #1174 form. */
async function liveHasSurgeForm() {
  for (const path of ["/signup", "/login"]) {
    const res = await fetch(`${SITE}${path}`, { headers: { "User-Agent": "Mozilla/5.0 (iKratom surge readiness check)" } }).catch(() => null);
    if (!res?.ok) continue;
    const html = await res.text();
    const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[\w\-./%~]+?\.js/g) ?? [])];
    for (const c of chunks) {
      const js = await fetch(`${SITE}${c}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
      if (js.includes(MARKER)) return true;
    }
  }
  return false;
}

async function queueCounts() {
  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return "unknown (no service role key)";
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const out = [];
  for (const status of ["pending", "failed"]) {
    const { count, error } = await sb.from("signup_email_queue").select("email", { count: "exact", head: true }).eq("status", status);
    out.push(error || count == null ? `${status} ?` : `${status} ${count}`);
  }
  return out.join(", ");
}

if (cmd === "status") {
  console.log("Supabase auth config:");
  printConfig(await authConfig());
  const ready = await liveHasSurgeForm();
  console.log(`Live ${SITE} signup form handles a rush (#1174): ${ready ? "yes" : "NO (signups past the email cap are lost until the next build)"}`);
  console.log(`Queued signup links: ${await queueCounts()}`);
} else if (cmd === "autoconfirm-on") {
  if (!(await liveHasSurgeForm()) && !force) {
    die("The live signup form predates #1174: new members would be told to check an email that never comes. Build first.");
  }
  printConfig(await authConfig({ mailer_autoconfirm: true }));
  console.log("✓ Autoconfirm ON: new members are signed in at once, no confirmation email. Undo: `autoconfirm-off`.");
} else if (cmd === "autoconfirm-off") {
  printConfig(await authConfig({ mailer_autoconfirm: false }));
  console.log("✓ Autoconfirm OFF: new members confirm by email again.");
} else {
  die(`Unknown command "${cmd}". Use status | autoconfirm-on | autoconfirm-off.`);
}
