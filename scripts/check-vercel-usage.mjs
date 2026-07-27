#!/usr/bin/env node
/**
 * check-vercel-usage.mjs — the HOSTING failsafe.
 *
 * Born from the 2026-07-22 incident: the whole Vercel account was soft-blocked
 * (`FAIR_USE_LIMITS_EXCEEDED` on `fluidCpuDuration` — 12h2m of CPU against a 4h
 * Hobby allowance) and www.ikratom.org served HTTP 402 `DEPLOYMENT_DISABLED` for
 * ~18 hours before anyone noticed. Nothing was watching.
 *
 * We DID have a watchdog — `check-egress-usage.mjs` — but it only reads Supabase
 * bandwidth against a 5GB budget. On 2026-07-18 it truthfully reported
 * "1.06GB / 21.2%, healthy" while the Vercel CPU meter sat at 301%. It was built
 * for the PREVIOUS disaster (2026-07-16 Supabase egress) and had zero visibility
 * into the platform that actually took the site down.
 *
 * The lesson generalizes, so this script does too. It checks three things, and
 * the LAST one is the important one:
 *
 *   1. Vercel account limited flag        — `GET /v2/user` → `limited`
 *   2. Vercel team soft-block + reason    — `GET /v2/teams/{id}` → `softBlock`
 *   3. IS THE SITE ACTUALLY UP?           — plain GET of APP_URL, expect 2xx
 *
 * (1) and (2) name the cause when the cause is Vercel. (3) catches EVERY cause,
 * including the next one we haven't thought of — a bad deploy, an expired cert,
 * a DNS mistake, a provider we haven't instrumented. A synthetic check of the
 * real user-facing URL is the only monitor that can't be blindsided by a meter
 * nobody added.
 *
 * Vercel exposes no public per-resource usage endpoint (`/v1/usage` 400s for
 * every documented param shape), so this is DETECTION, not prediction: it turns
 * "down for 18 hours" into "paged within the hour". Prevention is architectural
 * — keep public pages statically generated so crawlers cost no compute. See
 * memory `root-layout-forces-whole-app-dynamic`.
 *
 * Runs hourly via cron-hourly.yml. Telemetry source: vercel_watchdog.
 *
 * Usage: node --env-file=.env.local scripts/check-vercel-usage.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";

const DRY = process.argv.includes("--dry-run");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
// Team that owns the ikratom project. Overridable so a future account move
// doesn't need a code change; the default is the current owner's team.
const TEAM_ID = process.env.VERCEL_TEAM_ID || "team_ZGMOvQ3FPi6lHFerlrOk6cvt";
// APP_URL is `http://localhost:3001` in local dev (see AGENTS.md). A watchdog
// that checks localhost tells us nothing about production, so ignore any
// loopback/private value and always monitor the canonical public URL.
const RAW_APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const IS_LOCAL = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(RAW_APP_URL);
const SITE_URL = process.env.WATCHDOG_SITE_URL?.replace(/\/+$/, "")
  || (RAW_APP_URL && !IS_LOCAL ? RAW_APP_URL : "https://www.ikratom.org");

if (!KEY || !URL_SB) { console.error("Missing Supabase env"); process.exit(1); }
const sb = createClient(URL_SB, KEY, { auth: { persistSession: false } });

const problems = [];
let vercelChecked = false;

// Which platform actually SERVES production. Since 2026-07-26 that's Netlify;
// Vercel is a paused cold spare. This matters because Vercel's account is still
// soft-blocked and always will be until its cycle resets — if we kept counting
// that as a "problem" this watchdog would page the owner every 6h forever about
// a platform we don't use. Classic cry-wolf, and cry-wolf is how a real alert
// gets ignored. Vercel state is still REPORTED (useful if we ever fail back),
// just not escalated unless Vercel is the live host.
const HOST_PLATFORM = (process.env.HOST_PLATFORM || "netlify").toLowerCase();
const vercelIsLive = HOST_PLATFORM === "vercel";

// ── 1 + 2. Vercel account / team state ───────────────────────────────────────
if (!VERCEL_TOKEN) {
  console.log("VERCEL_TOKEN not set — skipping Vercel API checks (site check still runs)");
} else {
  const vh = { Authorization: `Bearer ${VERCEL_TOKEN}` };
  try {
    const uRes = await fetch("https://api.vercel.com/v2/user", { headers: vh });
    if (uRes.ok) {
      vercelChecked = true;
      const { user } = await uRes.json();
      if (user?.limited && vercelIsLive) problems.push("Vercel account is LIMITED (usage cap hit)");
      console.log(`vercel user.limited = ${!!user?.limited}`);
    } else {
      console.log(`vercel /v2/user → ${uRes.status}`);
    }
  } catch (e) { console.log(`vercel /v2/user failed: ${e.message}`); }

  try {
    const tRes = await fetch(`https://api.vercel.com/v2/teams/${TEAM_ID}`, { headers: vh });
    if (tRes.ok) {
      vercelChecked = true;
      const team = await tRes.json();
      const sbk = team?.softBlock;
      if (sbk && vercelIsLive) {
        const when = sbk.blockedAt ? new Date(sbk.blockedAt).toISOString().slice(0, 16).replace("T", " ") : "unknown";
        problems.push(`Vercel SOFT-BLOCK: ${sbk.reason} on ${sbk.blockedDueToOverageType ?? "unknown resource"} (since ${when} UTC)`);
      }
      if (team?.blocked && vercelIsLive) problems.push("Vercel team is BLOCKED");
      console.log(`vercel team.softBlock = ${sbk ? sbk.reason : "none"}`);
    } else {
      console.log(`vercel /v2/teams → ${tRes.status}`);
    }
  } catch (e) { console.log(`vercel /v2/teams failed: ${e.message}`); }
}

// ── 2b. NETLIFY meters — the live host since 2026-07-26 ──────────────────────
// The whole lesson of the Vercel outage was "a meter nobody watched killed the
// site." Moving hosts does not solve that; it just changes which meters matter.
// Netlify free has its own ceilings (bandwidth, build minutes, function
// invocations) and `block_builds_when_usage_exceeded` is TRUE on this account —
// so blowing a limit stops deploys, exactly like Vercel's block stopped serving.
// Watch them from day one instead of discovering them the hard way.
const NETLIFY_TOKEN = process.env.NETLIFY_AUTH_TOKEN;
const NETLIFY_ACCOUNT = process.env.NETLIFY_ACCOUNT_SLUG || "ohjustadam";
if (!NETLIFY_TOKEN) {
  console.log("NETLIFY_AUTH_TOKEN not set — skipping Netlify meter checks");
} else {
  const nh = { Authorization: `Bearer ${NETLIFY_TOKEN}` };
  try {
    const aRes = await fetch(`https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT}`, { headers: nh });
    if (aRes.ok) {
      const acct = await aRes.json();
      // Netlify's OWN authoritative "you are over" list. Non-empty = builds
      // and/or serving are at risk right now.
      const exceeded = acct.usages_exceeded ?? [];
      if (Array.isArray(exceeded) && exceeded.length) {
        problems.push(`Netlify USAGE EXCEEDED: ${exceeded.join(", ")} — builds may be blocked`);
      }
      console.log(`netlify usages_exceeded = ${JSON.stringify(exceeded)}`);
    } else {
      console.log(`netlify /accounts → ${aRes.status}`);
    }
  } catch (e) { console.log(`netlify account check failed: ${e.message}`); }

  try {
    const bRes = await fetch(`https://api.netlify.com/api/v1/accounts/${NETLIFY_ACCOUNT}/bandwidth`, { headers: nh });
    if (bRes.ok) {
      const bw = await bRes.json();
      const usedGb = (bw.used ?? 0) / 1e9;
      // Free tier is 100 GB/mo. `included` comes back null on free, so budget
      // from the documented figure rather than trusting a null.
      const budgetGb = (bw.included ? bw.included / 1e9 : 100);
      const pct = (usedGb / budgetGb) * 100;
      // Warn EARLY. The Vercel lesson: by the time you're at 100% you're already
      // down, and on a monthly meter there is no way to un-spend usage.
      if (pct >= 75) problems.push(`Netlify bandwidth ${usedGb.toFixed(1)}GB / ${budgetGb}GB (${pct.toFixed(0)}%) this cycle`);
      console.log(`netlify bandwidth = ${usedGb.toFixed(2)}GB / ${budgetGb}GB (${pct.toFixed(1)}%) · resets ${String(bw.period_end_date ?? "").slice(0, 10)}`);
    }
  } catch (e) { console.log(`netlify bandwidth check failed: ${e.message}`); }
}

// ── 3. Synthetic site check — the cause-agnostic one ─────────────────────────
let siteStatus = 0;
let siteErr = "";
try {
  const res = await fetch(SITE_URL, {
    redirect: "follow",
    // A browser-shaped UA is REQUIRED since Cloudflare Bot Fight Mode went on
    // (2026-07-26). The honest "ikratom-watchdog/1.0" UA is bot-shaped by
    // definition, so Cloudflare 403'd our own monitor and it paged "SITE DOWN"
    // while the site was perfectly healthy. Our bot protection was blocking our
    // bot detector. Cry-wolf alerts are how real alerts get ignored, so this
    // matters more than the cosmetic honesty of the UA string.
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 ikratom-watchdog/1.0",
    },
    signal: AbortSignal.timeout(25_000),
  });
  siteStatus = res.status;
  if (!res.ok) {
    // Vercel names its own failure in this header — surface it verbatim so the
    // push tells the owner WHY, not just that something is wrong.
    const vErr = res.headers.get("x-vercel-error");
    // Distinguish "our own edge blocked us" from "the app is broken". A 403
    // carrying a CF-RAY is Cloudflare refusing the request, NOT an outage —
    // paging the owner out of bed for that is exactly the failure this
    // watchdog exists to prevent.
    const cfBlocked = res.status === 403 && !!res.headers.get("cf-ray");
    if (cfBlocked) {
      console.log("site returned 403 from Cloudflare — edge challenge, not an outage; not paging");
    } else {
      problems.push(`SITE DOWN: ${SITE_URL} returned ${res.status}${vErr ? ` (${vErr})` : ""}`);
    }
  }
} catch (e) {
  siteErr = e.message;
  problems.push(`SITE UNREACHABLE: ${SITE_URL} — ${e.message}`);
}
console.log(`site check: ${SITE_URL} → ${siteStatus || `ERROR ${siteErr}`}`);

// ── Page the owner (once per distinct problem-set per 6h) ────────────────────
const signature = problems.join(" | ") || "ok";
let pagedNote = "";

if (problems.length > 0) {
  console.log(`⚠ ${problems.length} problem(s):`);
  for (const p of problems) console.log(`   - ${p}`);

  // Dedupe: don't re-page for the same problem-set inside 6h. A CHANGED
  // signature pages immediately — escalation matters more than quiet.
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: recent } = await sb
    .from("scraper_runs")
    .select("notes")
    .eq("source", "vercel_watchdog")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(20);
  const alreadyPaged = (recent ?? []).some((r) => (r.notes ?? "").includes(`paged:${signature}`));

  if (alreadyPaged) {
    console.log("already paged for this exact problem-set within 6h — not re-paging");
  } else if (!DRY) {
    pagedNote = ` paged:${signature}`;
    const { data: owner } = await sb.from("profiles").select("id").eq("is_owner", true).maybeSingle();
    if (owner) {
      const { data: subs } = await sb
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", owner.id);
      const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
      if (subs?.length && pub && priv) {
        const require = createRequire(import.meta.url);
        const webpush = require("web-push");
        webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@ikratom.org", pub, priv);
        const payload = JSON.stringify({
          title: siteStatus && siteStatus < 400 ? "⚠ iKratom hosting warning" : "🚨 iKratom is DOWN",
          body: problems.join(" · ").slice(0, 300),
          link: "/admin/ops",
          tag: "vercel-watchdog",
        });
        for (const s of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              payload,
              { TTL: 6 * 3600 }
            );
          } catch { /* per-sub best-effort */ }
        }
        console.log(`paged owner across ${subs.length} subscription(s)`);
      } else {
        console.log("no push subscriptions / VAPID keys — cannot page");
      }
    }
  } else {
    pagedNote = " [dry-run: would page]";
  }
} else {
  console.log("✓ all clear");
}

// ── Telemetry ────────────────────────────────────────────────────────────────
if (!DRY) {
  try {
    await sb.from("scraper_runs").insert({
      source: "vercel_watchdog",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: problems.length > 0 ? "error" : "success",
      rows_updated: siteStatus,
      notes: `site ${siteStatus || "ERR"}${vercelChecked ? "" : " (vercel api unchecked)"}${problems.length ? ` · ${problems.length} problem(s)` : ""}${pagedNote}`.slice(0, 500),
    });
  } catch { /* best-effort */ }
}
console.log("Done.");
