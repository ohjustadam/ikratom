#!/usr/bin/env node
/**
 * send-queued-signup-links.mjs — mail the confirm link to signups that Supabase
 * Auth could not email.
 *
 * WHY (2026-11-17 scale audit): Supabase sends signup confirmations through
 * Resend, capped at 30 an hour project-wide and 100 a day by Resend. Past
 * either, it rolls the signup back. src/modules/auth/signup-queue.ts now makes
 * those accounts anyway (unconfirmed) and queues them in `signup_email_queue`
 * (migration 0325). This job mails each one its link through the cron email
 * pool, Brevo first (its own 300 a day), oldest first, hourly.
 *
 * The link is a fresh `signup` link from the admin API, the same kind Supabase
 * would have sent, so it goes to /auth/confirm?type=email like every other
 * confirmation. Proven on production 2026-11-17 with throwaway accounts:
 *  - a `signup` link keeps the password the member chose. The throwaway
 *    password this script must pass is ignored for an existing account.
 *  - a `magiclink` link would WIPE that password. Never switch to it.
 *  - each new link retires the previous one; a confirmed address is refused
 *    (email_exists), which marks the row `confirmed`.
 * The link expires an hour after this job mints it (mailer_otp_exp). A member
 * who misses that window uses "Resend the link" on /login, which queues the
 * address again when Supabase is still out of email.
 *
 *   node --env-file=.env.local scripts/send-queued-signup-links.mjs            # send
 *   node --env-file=.env.local scripts/send-queued-signup-links.mjs --dry-run  # count only
 *   --limit N   at most N links this run (default 100)
 */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, remainingToday, providerSummary } from "./lib/email-send.mjs";

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
const LIMIT = Number(argv[argv.indexOf("--limit") + 1]) || 100;
const SOURCE = "signup_link_queue";
const MAX_ATTEMPTS = 5;
const PROD_URL = "https://www.ikratom.org";
const envUrl = process.env.EMAIL_APP_URL || process.env.APP_URL || PROD_URL;
const APP_URL = (/localhost|127\.0\.0\.1/.test(envUrl) ? PROD_URL : envUrl).replace(/\/$/, "");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const startedAt = new Date().toISOString();

/** The confirm email, worded like the Supabase template (scripts/lib/auth-email-templates.mjs). */
function renderConfirmEmail(link) {
  const html = [
    "<h2>Confirm your email</h2>",
    "<p>Thanks for joining iKratom, and thanks for waiting: a lot of people signed up at once. Tap the button to confirm your address. It signs you in and takes you to set up your account.</p>",
    `<p style="margin:28px 0"><a href="${link}" style="display:inline-block;background:#10b981;color:#0a0a0a;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Confirm my email</a></p>`,
    "<p>The link works once and expires in an hour. If it has expired, go to iKratom, choose Sign in, and use \"Resend the link\". Your password is the one you chose when you signed up.</p>",
    `<p style="color:#666;font-size:12px">If the button doesn't work, copy this address into your browser:<br>${link}</p>`,
    `<p style="color:#666;font-size:12px">Didn't sign up? Ignore this email and nothing happens.</p>`,
  ].join("\n");
  const text = `Confirm your iKratom account: ${link}\n\nThe link works once and expires in an hour. Didn't sign up? Ignore this email.`;
  return { subject: "Confirm your iKratom account", html, text };
}

async function update(email, patch) {
  const { error } = await sb.from("signup_email_queue").update(patch).eq("email", email);
  if (error) console.error(`  ! queue update failed for a row: ${error.message}`);
}

async function main() {
  const { data: rows, error } = await sb.from("signup_email_queue")
    .select("email, attempts").eq("status", "pending").order("queued_at").limit(LIMIT);
  if (error) throw new Error(`read queue: ${error.message}`);
  let budget = DRY ? Infinity : await remainingToday(sb, { priority: "auth" });
  const n = { sent: 0, confirmed: 0, failed: 0, deferred: 0 };
  const errors = [];

  for (const row of rows ?? []) {
    if (budget <= 0) { n.deferred++; continue; }
    if (DRY) { n.sent++; continue; }
    const attempts = (row.attempts ?? 0) + 1;
    // A `signup` link CREATES an account for an unknown address, so only mail
    // addresses that already have one (the resend form queues any address).
    const esc = row.email.replace(/[\\%_]/g, (c) => `\\${c}`);
    const { data: prof } = await sb.from("profiles").select("id").ilike("email", esc).limit(1).maybeSingle();
    if (!prof) { await update(row.email, { status: "failed", last_error: "no account for this address" }); n.failed++; continue; }
    // Required by the API, ignored for an existing account (see header). Random so it is never usable.
    const g = await sb.auth.admin.generateLink({ type: "signup", email: row.email, password: `${crypto.randomUUID()}A1!` });
    if (g.error) {
      if (g.error.code === "email_exists" || /already (been )?registered/i.test(g.error.message)) {
        await update(row.email, { status: "confirmed", last_error: null });
        n.confirmed++;
      } else {
        await update(row.email, { attempts, last_error: g.error.message.slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" });
        n.failed++;
        if (errors.length < 3) errors.push(g.error.message);
      }
      continue;
    }
    const link = `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(g.data.properties.hashed_token)}&type=email`;
    const r = await sendEmail(sb, { to: row.email, ...renderConfirmEmail(link), tag: "signup_confirm" }, { priority: "auth" });
    budget--;
    if (r.ok) {
      await update(row.email, { status: "sent", sent_at: new Date().toISOString(), attempts, last_error: null });
      n.sent++;
    } else {
      await update(row.email, { attempts, last_error: r.error.slice(0, 500), status: attempts >= MAX_ATTEMPTS ? "failed" : "pending" });
      n.failed++;
      if (errors.length < 3) errors.push(r.error);
    }
  }
  return { ...n, pending: rows?.length ?? 0, errors };
}

try {
  console.log(`signup link queue${DRY ? " (DRY RUN)" : ""} · providers: ${providerSummary()} · app ${APP_URL}`);
  const r = await main();
  const summary = `pending ${r.pending} · sent ${r.sent} · already confirmed ${r.confirmed} · failed ${r.failed} · deferred ${r.deferred} (quota)` +
    (r.errors.length ? ` · errors: ${r.errors.join(" ; ")}` : "");
  console.log(summary);
  const status = r.failed > 0 && r.sent === 0 ? "error" : r.deferred > 0 ? "partial" : "success";
  // Telemetry on every run, even an empty one, so a dead job reads as stale, not quiet.
  if (!DRY) await sb.from("scraper_runs").insert({ source: SOURCE, started_at: startedAt, finished_at: new Date().toISOString(), status, rows_updated: r.sent, notes: summary.slice(0, 900) });
  process.exitCode = status === "error" ? 1 : 0;
} catch (e) {
  console.error(`✗ ${e.message}`);
  if (!DRY) await sb.from("scraper_runs").insert({ source: SOURCE, started_at: startedAt, finished_at: new Date().toISOString(), status: "error", rows_updated: 0, notes: e.message.slice(0, 900) });
  process.exitCode = 1;
}
