#!/usr/bin/env node
/**
 * smoke-check.mjs — prove the LIVE site actually works after a deploy.
 *
 * Born 2026-07-26 after two production-only failures in one day, both of which
 * a local build swore were fine:
 *   1. the build OOM'd on Netlify's container but passed locally (more RAM)
 *   2. a stubbed SUPABASE_SERVICE_ROLE_KEY in netlify.toml beat the real env
 *      var, so every server render got a dead DB client — /donate 500'd in
 *      production while serving 200 on localhost, where .env.local supplied
 *      the real key
 *
 * The lesson both times: a green build is not a working site, and a local pass
 * proves nothing about the deploy environment. The only trustworthy check is
 * hitting the real URL after the real deploy.
 *
 * Checks STATUS **and CONTENT** — a 200 that renders an error shell or has lost
 * a critical element is still a broken page, and status-only checks miss it.
 *
 *   node scripts/smoke-check.mjs                       # after a deploy
 *   node scripts/smoke-check.mjs --url https://…       # any environment
 *
 * Exits non-zero on failure so it can gate a deploy step or fail CI.
 */

const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
const SITE = (arg("--url") || "https://www.ikratom.org").replace(/\/+$/, "");

/**
 * Each check names what MUST be present. `must` catches the silent-regression
 * class: the page loads, but the thing that makes it useful is gone — exactly
 * how the donation strip vanished sitewide without a single error.
 */
const CHECKS = [
  { path: "/", name: "homepage", must: [/iKratom/i] },
  // Only INVARIANTS belong here. PayPal was asserted at first and is wrong to
  // assert: `donateConfig.paypalUrl` is optional by design and the option
  // auto-hides when it's empty, so a healthy page with PayPal deliberately
  // unset would be reported as a broken site. Cash App and the "another way"
  // fallback always render.
  { path: "/donate", name: "donate", must: [/cash\.app/i, /Another way to give/i] },
  { path: "/bills", name: "bills", must: [/\/bills\//] },
  { path: "/login", name: "login", must: [/password|sign in/i] },
  { path: "/api/me", name: "api/me", must: [/"userId"/] },
];

/**
 * Retry before declaring failure. Observed on 2026-07-27: /donate answered 404
 * on one run and 200 a few minutes later, with every other route serving 200
 * throughout. This script runs right after a deploy by design, so it samples
 * the least stable moment the site ever has.
 *
 * Retrying does not paper over a real outage — a genuinely broken route still
 * burns all 3 attempts and still exits 1. What it removes is the single-sample
 * false positive, the same defect as the false SITE DOWN page and the audit
 * harness's six phantom criticals: a checker that cries wolf is worse than no
 * checker.
 *
 * ⚠ But do NOT read an intermittent 404 here as automatically harmless. A
 * Turbopack production build on Netlify can break Sentry's instrumentation hook
 * so the server never boots, and the first symptom looks exactly like "only
 * /donate is broken" — static pages keep serving from the CDN while dynamic
 * routes fail (see the --webpack warning in netlify.toml). If a failure recurs
 * across runs, read the Netlify function log before blaming a deploy swap.
 */
const ATTEMPTS = 3;
const RETRY_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(check) {
  const url = `${SITE}${check.path}`;
  const res = await fetch(url, {
    redirect: "follow",
    // Browser-shaped UA: Cloudflare Bot Fight Mode 403s honest bot UAs, which
    // would make this cry wolf on a perfectly healthy site.
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 ikratom-smoke/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  const missing = (check.must ?? []).filter((re) => !re.test(body));
  return { ok: res.ok && missing.length === 0, status: res.status, missing };
}

let failed = 0;
for (const c of CHECKS) {
  let last = null;
  let attempt = 0;

  while (attempt < ATTEMPTS) {
    attempt++;
    try {
      last = await probe(c);
    } catch (e) {
      last = { ok: false, status: "ERR", missing: [], error: e.message };
    }
    if (last.ok) break;
    if (attempt < ATTEMPTS) await sleep(RETRY_MS);
  }

  if (!last.ok) failed++;
  const retried = attempt > 1 ? `  (${attempt} attempts)` : "";
  console.log(
    `  [${last.ok ? "PASS" : "FAIL"}] ${c.name.padEnd(10)} ${last.status}` +
    (last.error ? `  unreachable: ${last.error}` : "") +
    (last.missing.length ? `  MISSING: ${last.missing.map(String).join(", ")}` : "") +
    retried
  );
}

console.log(failed ? `\n✗ ${failed} check(s) FAILED on ${SITE}\n` : `\n✓ all ${CHECKS.length} checks passed on ${SITE}\n`);
process.exit(failed ? 1 : 0);
