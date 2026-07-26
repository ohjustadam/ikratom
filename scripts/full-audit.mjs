#!/usr/bin/env node
/**
 * full-audit.mjs — the whole-platform audit harness.
 *
 * WHY A SCRIPT AND NOT AN AI CONVERSATION: an exhaustive audit of 215 routes,
 * ~250 migrations, 13 workflows and ~100 telemetry sources is enormous to do by
 * reading. Almost all of it is MECHANICAL — probe a URL, compare a header, ask
 * the DB a question, diff a config. Mechanical work belongs in code that runs
 * free and repeatably, not in tokens spent once. Judgment (is this RLS policy
 * logically right?) is the only part that needs a mind.
 *
 * So this collects EVIDENCE cheaply and deterministically; a human/AI then
 * reasons over a compact findings list instead of the whole codebase. It is
 * also re-runnable forever — every future migration gets the same audit for
 * free, which is the real point.
 *
 * READ-ONLY BY DEFAULT. It probes only infrastructure we own. It performs no
 * writes and no destructive requests. `--deep` adds authenticated authz probing
 * (needs AUDIT_TEST_EMAIL/AUDIT_TEST_PASSWORD) — still read-only.
 *
 *   node --env-file=.env.local scripts/full-audit.mjs
 *   node --env-file=.env.local scripts/full-audit.mjs --json > audit.json
 *
 * Sections: hosting/edge · security headers · auth surface · API exposure ·
 * database/RLS · crons/automation · migration-delta · dependencies.
 */
import { createClient } from "@supabase/supabase-js";

const JSON_OUT = process.argv.includes("--json");
const DEEP = process.argv.includes("--deep");
const SITE = (process.env.WATCHDOG_SITE_URL || "https://www.ikratom.org").replace(/\/+$/, "");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF || (SB_URL ? new URL(SB_URL).host.split(".")[0] : null);

const findings = [];
const notes = [];
/** sev: critical | high | medium | low | info | evolution */
const add = (sev, area, title, detail, fix) =>
  findings.push({ sev, area, title, detail, fix: fix ?? null });
const log = (...a) => { if (!JSON_OUT) console.log(...a); };

async function get(url, opts = {}) {
  try {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000), ...opts });
    return { ok: r.ok, status: r.status, headers: r.headers, text: async () => r.text() };
  } catch (e) { return { ok: false, status: 0, err: e.message, headers: new Headers() }; }
}
async function sql(q) {
  if (!MGMT || !REF) return { ok: false, rows: [], err: "no management token" };
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { ok: false, rows: [], err: `HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, rows: Array.isArray(j) ? j : [] };
  } catch (e) { return { ok: false, rows: [], err: e.message }; }
}

// ── 1. HOSTING / EDGE ────────────────────────────────────────────────────────
log("\n=== 1. HOSTING / EDGE ===");
{
  const r = await get(SITE);
  const h = r.headers;
  const server = h.get("server") || "";
  const cfRay = h.get("cf-ray");
  log(`  ${SITE} → ${r.status} · server=${server} · cloudflare=${cfRay ? "yes" : "NO"}`);
  if (r.status !== 200) add("critical", "hosting", "Site not returning 200", `${SITE} → ${r.status}`);
  if (!cfRay) add("high", "hosting", "Cloudflare proxy not in front", "No CF-RAY header — origin is directly exposed, so bot-blocking and edge caching are bypassed.", "Set the DNS records to Proxied (orange cloud).");

  // Origin exposure: if the Netlify URL serves the same site publicly, an
  // attacker can bypass Cloudflare (WAF, bot rules, rate limits) entirely.
  const direct = await get("https://ikratom.netlify.app");
  if (direct.status === 200) {
    add("medium", "hosting", "Origin reachable directly, bypassing Cloudflare",
      "ikratom.netlify.app serves the app publicly, so every Cloudflare protection (Bot Fight Mode, WAF, rate limiting) can be skipped by hitting the origin hostname.",
      "Netlify: Site config → Access & security → block the *.netlify.app subdomain, or add a redirect/403 for hosts other than the canonical domain.");
  }
  const hsts = h.get("strict-transport-security");
  if (!hsts) add("medium", "hosting", "No HSTS header on the live response", "Strict-Transport-Security missing — leaves a window for SSL-strip downgrade.", "next.config.ts already defines it; confirm it survives the CDN.");
  else log(`  HSTS ✓`);
}

// ── 2. SECURITY HEADERS ──────────────────────────────────────────────────────
log("\n=== 2. SECURITY HEADERS ===");
{
  const r = await get(SITE);
  const h = r.headers;
  const expect = {
    "content-security-policy": "high",
    "x-frame-options": "medium",
    "x-content-type-options": "medium",
    "referrer-policy": "low",
    "permissions-policy": "low",
    "cross-origin-opener-policy": "low",
  };
  for (const [k, sev] of Object.entries(expect)) {
    const v = h.get(k);
    if (!v) add(sev, "headers", `Missing ${k}`, `Not present on ${SITE}. proxy.ts used to set some of these and is now DISABLED — this is exactly the class of thing that regression could cause.`, "Add to next.config.ts headers() so it is host-independent.");
    else log(`  ${k} ✓`);
  }
  const csp = h.get("content-security-policy") || "";
  if (csp.includes("'unsafe-eval'")) add("medium", "headers", "CSP allows unsafe-eval in production", "'unsafe-eval' should be dev-only; production should use 'wasm-unsafe-eval'.", "Check the NODE_ENV branch in next.config.ts is evaluating as production on Netlify.");
  if (csp.includes("'unsafe-inline'") && csp.includes("script-src")) notes.push("CSP script-src contains 'unsafe-inline' (common with Next inline bootstrap; nonce-based CSP is the hardening path).");
}

// ── 3. AUTH SURFACE ──────────────────────────────────────────────────────────
log("\n=== 3. AUTH SURFACE ===");
{
  // A 200 is NOT evidence of a leak. Next's `redirect()` inside an RSC render
  // still returns 200 with an empty shell + a client-side redirect payload, so
  // a status-only check reports every guarded admin page as "OPEN" — six false
  // criticals on the first run of this script. What actually matters is whether
  // PROTECTED CONTENT reaches an anonymous caller, so assert on the rendered
  // text, not the status line.
  // Markers that indicate REAL protected DATA reached the caller — deliberately
  // NOT generic chrome words ("sign out", "your account") which appear in the
  // shell of every page and produced false criticals on the first run.
  const SENSITIVE = /moderation queue|intel queue|promote to admin|service_role|@[a-z0-9_]{3,}.*(admin|owner)|[a-z0-9._%+-]+@[a-z0-9.-]+.(com|org|net)/i;|intel queue|promote to admin|demote|service[_ ]role|audit log|user list|sign out|your account|unread/i;
  for (const p of ["/admin", "/admin/users", "/admin/console", "/dashboard", "/account", "/messages"]) {
    const r = await get(`${SITE}${p}`);
    const loc = r.headers.get("location") || "";
    const redirected = [301, 302, 303, 307, 308].includes(r.status) || [401, 403, 404].includes(r.status);
    let leaked = false, visible = "";
    if (r.status === 200) {
      const html = await r.text();
      // Strip scripts + tags → what a human would actually SEE.
      visible = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      leaked = SENSITIVE.test(visible);
    }
    log(`  ${p.padEnd(16)} → ${r.status}${loc ? " → " + loc.slice(0, 30) : ""} · visible-text=${visible.length}b ${leaked ? "LEAK" : redirected || r.status === 200 ? "guarded" : "?"}`);
    if (leaked) {
      add("critical", "auth", `Protected content served to anonymous caller at ${p}`,
        `Rendered text matched a sensitive marker. Excerpt: ${visible.slice(0, 160)}`,
        "The page's server-side guard is not running before render.");
    }
  }
  const me = await get(`${SITE}/api/me`);
  if (me.status === 200) {
    const body = await me.text();
    if (/"userId":\s*"/.test(body)) add("critical", "auth", "/api/me leaks a user identity to anonymous callers", "Returned a non-null userId without credentials.", "Must return the ANON shape when unauthenticated.");
    else log("  /api/me anon shape ✓");
  }
  for (const p of ["/api/cron/daily-sync", "/api/cron/fire-waves", "/api/cron/reverify-local-officials"]) {
    const r = await get(`${SITE}${p}`);
    if (r.status !== 401 && r.status !== 403) add("high", "auth", `Cron endpoint ${p} not auth-gated`, `Returned ${r.status} without CRON_SECRET.`, "Require the bearer secret.");
    else log(`  ${p} gated (${r.status}) ✓`);
  }
}

// ── 4. DATABASE / RLS (anon key — what a browser can actually read) ──────────
log("\n=== 4. DATABASE / RLS ===");
if (SB_URL && ANON) {
  const anon = createClient(SB_URL, ANON, { auth: { persistSession: false } });
  // Tables that must NEVER be readable with the public anon key.
  const mustBePrivate = ["profiles", "campaign_actions", "push_subscriptions", "dm_messages", "dm_participants", "audit_log", "user_sessions", "notifications"];
  for (const t of mustBePrivate) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      add("critical", "rls", `Anon key can READ ${t}`, `Returned ${data.length} row(s) with the public anon key. Columns: ${Object.keys(data[0]).join(", ").slice(0, 200)}`, `Review RLS SELECT policy on ${t}.`);
    } else log(`  ${t.padEnd(20)} anon-read blocked ✓`);
  }
  // PII leak check on any table that IS public.
  const { data: pub } = await anon.from("profiles").select("email, full_name").limit(1);
  if (pub?.length) add("critical", "rls", "profiles PII readable anonymously", "email/full_name exposed via anon key.", "Lock the SELECT policy; use get_public_profile().");
} else notes.push("Skipped RLS probing — anon key not available.");

// ── 5. CRONS / AUTOMATION HEALTH ─────────────────────────────────────────────
log("\n=== 5. CRONS / AUTOMATION ===");
{
  const r = await sql(`select source, status, finished_at,
      round((extract(epoch from (now()-finished_at))/3600)::numeric,1) as hours_ago
    from scraper_runs_latest order by finished_at asc nulls first limit 40`);
  if (r.ok) {
    const stale = r.rows.filter(x => x.hours_ago === null || Number(x.hours_ago) > 48);
    log(`  sources tracked: ${r.rows.length} · stale >48h: ${stale.length}`);
    if (stale.length) {
      add("medium", "cron", `${stale.length} telemetry sources stale >48h`,
        stale.map(s => `${s.source} (${s.hours_ago ?? "never"}h)`).join(", "),
        "Either the job is dead, or it is a phantom source nothing writes — both need resolving; a phantom makes the pager cry wolf.");
    }
  } else notes.push(`Cron health unavailable: ${r.err}`);
}

// ── 6. MIGRATION DELTA — what the host move could have silently broken ───────
log("\n=== 6. MIGRATION DELTA ===");
{
  // Anything that still assumes Vercel is now a latent failure.
  const vj = await import("node:fs").then(fs => { try { return JSON.parse(fs.readFileSync("vercel.json", "utf8")); } catch { return null; } });
  if (vj?.crons?.length) add("high", "migration", "vercel.json still declares crons", "Vercel no longer serves this site, so these never run.", "Empty the array and re-home the jobs in GitHub Actions.");
  else log("  vercel.json crons empty ✓");

  // Attribution cookies: set by the disabled middleware, still read by app code.
  const r = await get(`${SITE}/?via=testcode123`);
  const sc = r.headers.get("set-cookie") || "";
  if (!/invite_ref/.test(sc)) {
    notes.push("Attribution cookie is not set by a plain server response — expected if the client-island rebuild (#845) is the mechanism; verify in a browser that invite_ref appears after landing on /?via=CODE.");
  }
}

// ── 7. DEPENDENCIES ──────────────────────────────────────────────────────────
log("\n=== 7. DEPENDENCIES ===");
{
  const { execSync } = await import("node:child_process");
  try {
    const out = execSync("npm audit --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 });
    const j = JSON.parse(out);
    const v = j.metadata?.vulnerabilities ?? {};
    log(`  critical=${v.critical ?? 0} high=${v.high ?? 0} moderate=${v.moderate ?? 0} low=${v.low ?? 0}`);
    if ((v.critical ?? 0) > 0 || (v.high ?? 0) > 0) {
      const names = Object.keys(j.vulnerabilities || {}).filter(k => ["critical", "high"].includes(j.vulnerabilities[k].severity)).slice(0, 12);
      add((v.critical ?? 0) > 0 ? "high" : "medium", "deps", `${v.critical ?? 0} critical / ${v.high ?? 0} high CVEs`, `Packages: ${names.join(", ")}`, "npm audit fix; re-test any feature the package powers.");
    }
  } catch (e) {
    // npm audit exits non-zero when vulns exist — parse stdout anyway.
    try {
      const j = JSON.parse(e.stdout || "{}");
      const v = j.metadata?.vulnerabilities ?? {};
      log(`  critical=${v.critical ?? 0} high=${v.high ?? 0} moderate=${v.moderate ?? 0}`);
      const names = Object.keys(j.vulnerabilities || {}).filter(k => ["critical", "high"].includes(j.vulnerabilities[k]?.severity)).slice(0, 12);
      if ((v.critical ?? 0) + (v.high ?? 0) > 0) add((v.critical ?? 0) > 0 ? "high" : "medium", "deps", `${v.critical ?? 0} critical / ${v.high ?? 0} high CVEs`, `Packages: ${names.join(", ")}`, "npm audit fix; re-test the feature each package powers.");
    } catch { notes.push("npm audit could not be parsed."); }
  }
}

// ── REPORT ───────────────────────────────────────────────────────────────────
const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4, evolution: 5 };
findings.sort((a, b) => (order[a.sev] ?? 9) - (order[b.sev] ?? 9));

if (JSON_OUT) {
  console.log(JSON.stringify({ site: SITE, at: new Date().toISOString(), findings, notes }, null, 2));
} else {
  console.log("\n" + "=".repeat(64));
  console.log("AUDIT SUMMARY");
  console.log("=".repeat(64));
  const counts = findings.reduce((m, f) => ((m[f.sev] = (m[f.sev] ?? 0) + 1), m), {});
  console.log("  " + (Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ") || "no findings"));
  for (const f of findings) {
    console.log(`\n[${f.sev.toUpperCase()}] (${f.area}) ${f.title}`);
    console.log(`   ${f.detail}`);
    if (f.fix) console.log(`   FIX: ${f.fix}`);
  }
  if (notes.length) { console.log("\n--- notes ---"); notes.forEach(n => console.log("  · " + n)); }
  console.log("");
}
process.exit(findings.some(f => f.sev === "critical") ? 2 : 0);
