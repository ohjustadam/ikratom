#!/usr/bin/env node
/**
 * configure-auth-smtp.mjs — send Supabase Auth email (signup confirmation,
 * password reset, magic links) through our own verified domain instead of
 * Supabase's built-in sender.
 *
 * WHY (2026-10-03): the built-in sender is capped at 2 emails per HOUR for the
 * whole platform (rate_limit_email_sent=2). A recruiting push at a shop event
 * would silently fail every signup after the second. Resend already sends for
 * ikratom.org (domain verified), so pointing Auth at it lifts the cap to what
 * we choose, from the same sender as every other iKratom email.
 *
 * Quota: Resend Free is 100/day shared with notifications. --rate defaults to
 * 30/hour; email-send.mjs keeps 10/day per provider in reserve for auth.
 * Wire Brevo (300/day) and run with --provider brevo to give auth its own pool.
 *
 *   node --env-file=.env.local scripts/configure-auth-smtp.mjs              # dry run: shows the change
 *   node --env-file=.env.local scripts/configure-auth-smtp.mjs --apply      # PRODUCTION config change
 *   node --env-file=.env.local scripts/configure-auth-smtp.mjs --revert --apply   # back to built-in, 2/hour
 *
 * Never prints the SMTP password (it is the provider API key).
 */
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const REVERT = argv.includes("--revert");
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const PROVIDER = arg("provider", "resend");
const RATE = Number(arg("rate", 30));

const E = process.env;
const url = `https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}/config/auth`;
const H = { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" };

const PROVIDERS = {
  resend: { host: "smtp.resend.com", port: "465", user: "resend", pass: E.RESEND_API_KEY, from: E.RESEND_FROM_EMAIL, name: E.RESEND_FROM_NAME },
  brevo: { host: "smtp-relay.brevo.com", port: "587", user: E.BREVO_SMTP_LOGIN, pass: E.BREVO_SMTP_KEY, from: E.BREVO_FROM_EMAIL, name: E.BREVO_FROM_NAME },
};

const patch = REVERT
  ? { smtp_host: null, smtp_port: null, smtp_user: null, smtp_pass: null, smtp_admin_email: null, smtp_sender_name: null, rate_limit_email_sent: 2 }
  : (() => {
      const p = PROVIDERS[PROVIDER];
      if (!p) throw new Error(`unknown --provider ${PROVIDER}`);
      const missing = Object.entries({ host: p.host, user: p.user, pass: p.pass, from: p.from }).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) { console.error(`✗ ${PROVIDER}: missing ${missing.join(", ")} in env`); process.exit(1); }
      return { smtp_host: p.host, smtp_port: p.port, smtp_user: p.user, smtp_pass: p.pass, smtp_admin_email: p.from, smtp_sender_name: p.name || "iKratom", rate_limit_email_sent: RATE };
    })();

const current = await (await fetch(url, { headers: H })).json();
const show = (o) => Object.fromEntries(Object.keys(patch).map((k) => [k, k === "smtp_pass" ? (o[k] ? "<set>" : null) : o[k] ?? null]));
console.log("current:", JSON.stringify(show(current)));
console.log("target: ", JSON.stringify(show(patch)));

if (!APPLY) { console.log("DRY RUN — nothing changed. Re-run with --apply (production Auth config)."); process.exit(0); }

const r = await fetch(url, { method: "PATCH", headers: H, body: JSON.stringify(patch) });
if (!r.ok) { console.error(`✗ ${r.status} ${(await r.text()).slice(0, 200)}`); process.exit(1); }
const after = await r.json();
console.log("applied:", JSON.stringify(show(after)));
console.log("Verify: request a password reset for a TEST account and confirm it arrives (Resend dashboard → Emails).");
