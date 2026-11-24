/**
 * Turnstile bot check on Supabase Auth: set up, check, turn on, roll back.
 *
 *   node --env-file=.env.local scripts/auth-captcha.mjs            # status (read-only)
 *   node --env-file=.env.local scripts/auth-captcha.mjs setup-keys # fill empty keys from the "iKratom sign-in" widget
 *                                                                  # (made only if none exists); adds either key to
 *                                                                  # Netlify only if missing there (--overwrite replaces)
 *   node --env-file=.env.local scripts/auth-captcha.mjs enable     # ONLY after the deploy carrying the widget code
 *   node --env-file=.env.local scripts/auth-captcha.mjs disable    # rollback: captcha off
 *   node --env-file=.env.local scripts/auth-captcha.mjs passwords  # 12-char minimum + reauth (owner yes first)
 *
 * ORDER MATTERS. Supabase rejects every sign-in, sign-up, resend and reset
 * without a valid token once captcha is on. The forms send one only when the
 * live site was BUILT with NEXT_PUBLIC_TURNSTILE_SITE_KEY. So `enable` refuses
 * unless the live /login page allows challenges.cloudflare.com in its CSP and
 * its JavaScript carries the site key (--force skips the check; don't).
 *
 * Never prints the secret. Needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF,
 * and for setup-keys NETLIFY_AUTH_TOKEN + NETLIFY_SITE_ID (+ CLOUDFLARE_ACCOUNT_ID
 * and a CLOUDFLARE_DEPLOY_TOKEN with "Turnstile: Edit" to create the widget).
 */
import fs from "node:fs";

const cmd = process.argv[2] ?? "status";
const force = process.argv.includes("--force");
const SITE = (process.env.CAPTCHA_CHECK_URL ?? "https://www.ikratom.org").replace(/\/$/, "");
const ENV_FILE = ".env.local";
const clean = (v) => (v ?? "").replace(/^﻿/, "").trim().replace(/^"|"$/g, "");
const env = (k) => clean(process.env[k]);
const die = (m) => { console.error(`✗ ${m}`); process.exit(1); };

// ── Supabase auth config ────────────────────────────────────────────────
const ref = env("SUPABASE_PROJECT_REF");
const mgmt = env("SUPABASE_ACCESS_TOKEN");
const authUrl = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
async function authConfig(patch) {
  if (!ref || !mgmt) die("Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN.");
  const r = await fetch(authUrl, {
    method: patch ? "PATCH" : "GET",
    headers: { Authorization: `Bearer ${mgmt}`, "Content-Type": "application/json" },
    body: patch ? JSON.stringify(patch) : undefined,
  });
  if (!r.ok) die(`${patch ? "PATCH" : "GET"} auth config → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
function printConfig(c) {
  console.log(`  security_captcha_enabled: ${c.security_captcha_enabled}`);
  console.log(`  security_captcha_provider: ${c.security_captcha_provider ?? "(none)"}`);
  console.log(`  password_min_length: ${c.password_min_length}`);
  console.log(`  security_update_password_require_reauthentication: ${c.security_update_password_require_reauthentication}`);
}

// ── Live-site readiness: the deploy must carry the widget ───────────────
async function liveReadiness() {
  const siteKey = env("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  const out = { csp: false, siteKeyInJs: false, notes: [] };
  if (!siteKey) { out.notes.push("NEXT_PUBLIC_TURNSTILE_SITE_KEY is empty in .env.local"); return out; }
  const res = await fetch(`${SITE}/login`, { headers: { "User-Agent": "Mozilla/5.0 (iKratom captcha readiness check)" } });
  if (!res.ok) { out.notes.push(`/login answered ${res.status}`); return out; }
  out.csp = /challenges\.cloudflare\.com/.test(res.headers.get("content-security-policy") ?? "");
  const html = await res.text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[\w\-./%~]+?\.js/g) ?? [])];
  for (const c of chunks) {
    const js = await fetch(`${SITE}${c}`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
    if (js.includes(siteKey)) { out.siteKeyInJs = true; break; }
  }
  if (!out.siteKeyInJs) out.notes.push(`site key not found in the ${chunks.length} scripts /login loads (the build predates the key or the code)`);
  return out;
}

// ── .env.local + Netlify env ────────────────────────────────────────────
function writeEnvLocal(key, value) {
  let t = fs.readFileSync(ENV_FILE, "utf8");
  const line = `${key}=${value}`;
  t = new RegExp(`^${key}=.*$`, "m").test(t) ? t.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${t.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_FILE, t);
}
async function netlify(path, init = {}) {
  const r = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${env("NETLIFY_AUTH_TOKEN")}`, "Content-Type": "application/json" },
  });
  const body = await r.text();
  return { ok: r.ok, status: r.status, json: body ? JSON.parse(body) : null };
}
async function saveToNetlify(vars) {
  if (!env("NETLIFY_AUTH_TOKEN") || !env("NETLIFY_SITE_ID")) die("Missing NETLIFY_AUTH_TOKEN or NETLIFY_SITE_ID.");
  const site = await netlify(`/sites/${env("NETLIFY_SITE_ID")}`);
  if (!site.ok) die(`Netlify site lookup → ${site.status}`);
  const base = `/accounts/${site.json.account_slug}/env`;
  const q = `?site_id=${site.json.id}`;
  const scopes = ["builds", "functions", "runtime", "post_processing"];
  for (const [key, value] of Object.entries(vars)) {
    const values = [{ value, context: "all" }];
    const exists = (await netlify(`${base}/${key}${q}`)).ok;
    // An existing var may be set up on purpose (the secret is is_secret and
    // limited to some deploy contexts), so it is left alone unless asked.
    if (exists && !process.argv.includes("--overwrite")) {
      console.log(`  - Netlify ${key} already set, left as is (--overwrite replaces it)`);
      continue;
    }
    const r = exists
      ? await netlify(`${base}/${key}${q}`, { method: "PUT", body: JSON.stringify({ key, scopes, values }) })
      : await netlify(`${base}${q}`, { method: "POST", body: JSON.stringify([{ key, scopes, values }]) });
    if (!r.ok) die(`Netlify ${exists ? "update" : "create"} ${key} → ${r.status}`);
    console.log(`  ✓ Netlify ${key} ${exists ? "updated" : "created"} (${value.length} chars)`);
  }
}
const WIDGET_NAME = "iKratom sign-in";
/** The "iKratom sign-in" widget: reused if it exists (never a second one), else created. */
async function findOrCreateWidget() {
  const acct = env("CLOUDFLARE_ACCOUNT_ID");
  const token = env("CLOUDFLARE_DEPLOY_TOKEN");
  if (!acct || !token) die("Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_DEPLOY_TOKEN.");
  const cf = (p, init = {}) => fetch(`https://api.cloudflare.com/client/v4/accounts/${acct}/challenges/widgets${p}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  }).then((r) => r.json());
  const list = await cf("");
  if (!list.success) die(`Couldn't list Turnstile widgets (${JSON.stringify(list.errors).slice(0, 160)}).`);
  const mine = list.result.find((w) => w.name === WIDGET_NAME);
  if (mine) {
    // A read-only token can fetch one widget's secret by its site key.
    const one = await cf(`/${mine.sitekey}`);
    if (!one.success || !one.result?.secret) die(`Found "${WIDGET_NAME}" but couldn't read its secret. Paste both keys into ${ENV_FILE}.`);
    console.log(`  ✓ Reusing the existing "${WIDGET_NAME}" widget`);
    return one.result;
  }
  if (list.result.length) {
    die(`Turnstile widgets exist (${list.result.map((w) => w.name).join(", ")}) but none is named "${WIDGET_NAME}". Paste the right one's keys into ${ENV_FILE}.`);
  }
  const made = await cf("", { method: "POST", body: JSON.stringify({
    name: WIDGET_NAME, domains: ["ikratom.org", "www.ikratom.org"], mode: "managed", region: "world",
  }) });
  if (!made.success) {
    die(`Couldn't create the widget (${JSON.stringify(made.errors).slice(0, 160)}). Make it at dash.cloudflare.com > Turnstile (name "${WIDGET_NAME}", hostnames ikratom.org + www.ikratom.org, Managed), then re-run setup-keys.`);
  }
  console.log(`  ✓ Created the "${WIDGET_NAME}" widget`);
  return made.result;
}

// ── Commands ────────────────────────────────────────────────────────────
if (cmd === "status") {
  console.log("Supabase auth config:");
  printConfig(await authConfig());
  console.log(`Keys in ${ENV_FILE}: site key ${env("NEXT_PUBLIC_TURNSTILE_SITE_KEY") ? "set" : "EMPTY"}, secret ${env("TURNSTILE_SECRET_KEY") ? "set" : "EMPTY"}`);
  const live = await liveReadiness();
  console.log(`Live ${SITE}/login: CSP allows Turnstile ${live.csp ? "yes" : "NO"}, site key in its JS ${live.siteKeyInJs ? "yes" : "NO"}`);
  live.notes.forEach((n) => console.log(`  - ${n}`));
  console.log(live.csp && live.siteKeyInJs ? "→ Ready: `enable` is safe." : "→ NOT ready: don't run `enable` yet.");
} else if (cmd === "setup-keys") {
  let siteKey = env("NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  let secret = env("TURNSTILE_SECRET_KEY");
  if (!siteKey || !secret) {
    const w = await findOrCreateWidget();
    siteKey = w.sitekey; secret = w.secret;
    writeEnvLocal("NEXT_PUBLIC_TURNSTILE_SITE_KEY", siteKey);
    writeEnvLocal("TURNSTILE_SECRET_KEY", secret);
    console.log(`  ✓ Site key ${siteKey} and the secret written to ${ENV_FILE}`);
  }
  await saveToNetlify({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: siteKey, TURNSTILE_SECRET_KEY: secret });
  console.log("Done. The NEXT production build picks up the site key. Supabase captcha is still OFF.");
} else if (cmd === "enable") {
  const secret = env("TURNSTILE_SECRET_KEY");
  if (!secret) die(`TURNSTILE_SECRET_KEY is empty in ${ENV_FILE}. Run setup-keys first.`);
  const live = await liveReadiness();
  if (!(live.csp && live.siteKeyInJs) && !force) {
    die(`Live site isn't ready (CSP ${live.csp ? "ok" : "missing Turnstile"}, site key in JS ${live.siteKeyInJs ? "ok" : "missing"}). Turning captcha on now would lock every member out. Deploy first.`);
  }
  printConfig(await authConfig({
    security_captcha_enabled: true,
    security_captcha_provider: "turnstile",
    security_captcha_secret: secret,
  }));
  console.log("✓ Captcha ON. Sign in once in a private window to confirm. Rollback: `disable`.");
} else if (cmd === "disable") {
  printConfig(await authConfig({ security_captcha_enabled: false }));
  console.log("✓ Captcha OFF (rollback). Sign-in works with or without a token again.");
} else if (cmd === "passwords") {
  printConfig(await authConfig({ password_min_length: 12, security_update_password_require_reauthentication: true }));
  console.log("✓ New passwords need 12+ characters; existing passwords keep working. Update the app's own 10-character checks to match.");
} else {
  die(`Unknown command "${cmd}". Use status | setup-keys | enable | disable | passwords.`);
}
