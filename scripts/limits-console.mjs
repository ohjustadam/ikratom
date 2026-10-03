#!/usr/bin/env node
/**
 * limits-console.mjs — one local page showing every free-tier ceiling that can
 * take iKratom down, with the worst risks on top.
 *
 *   npm run limits            -> http://127.0.0.1:4319
 *
 * WHY (2026-10-02): the site went dark because the only gauge on Netlify
 * credits was a daily MODEL that could not see a 25-minute burst, and nothing
 * else watched the other ceilings at all. This page reads what can be read and
 * is explicit about what cannot:
 *
 *   measured  read live from the provider or the database
 *   estimate  a model (e.g. Netlify credits, Supabase egress) — fine for drift,
 *             blind to bursts. Never treat it as the meter.
 *   manual    typed in from a dashboard that has no API (Netlify's true credit
 *             total). Shown as STALE after 24h.
 *   config    a setting that is itself a risk (e.g. 2 auth emails per hour).
 *
 * Runs locally on purpose: it must keep working when the site is down, which is
 * exactly when it is needed. Binds to 127.0.0.1 only and never sends a key to
 * the browser. Every collector is isolated — one failing provider shows as an
 * error card, never a blank page.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { estimateNetlifyCredits } from "./lib/netlify-credits.mjs";
import { getEgressStatus, BUDGET_GB } from "./lib/egress-budget.mjs";

const E = process.env;
const PORT = Number(E.LIMITS_PORT || 4319);
const MANUAL_FILE = path.resolve("private/limits-manual.json"); // gitignored
const CF_ZONE = E.CLOUDFLARE_ZONE_ID || "6f054a2b237f9b7ec10d525ec7e99d05";
const NETLIFY_SLUG = E.NETLIFY_ACCOUNT_SLUG || "ohjustadam";
const NETLIFY_DASH = `https://app.netlify.com/teams/${NETLIFY_SLUG}/billing/general`;
const sb = createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const json = async (url, init = {}) => {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} -> ${r.status}`);
  return r.json();
};
const sql = (query) => json(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}/database/query`, {
  method: "POST", headers: { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ query }),
});
const cf = async (gql) => {
  const j = await json("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${E.CLOUDFLARE_CACHE_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ query: gql }),
  });
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data.viewer.zones[0];
};
const gh = (p) => json(`https://api.github.com/repos/${E.GITHUB_REPO_OWNER}/${E.GITHUB_REPO_NAME}${p}`, {
  headers: { Authorization: `Bearer ${E.GITHUB_TOKEN}`, "User-Agent": "ikratom-limits", Accept: "application/vnd.github+json" },
});
const nf = (p) => json(`https://api.netlify.com/api/v1${p}`, { headers: { Authorization: `Bearer ${E.NETLIFY_AUTH_TOKEN}` } });
const readManual = () => { try { return JSON.parse(fs.readFileSync(MANUAL_FILE, "utf8")); } catch { return {}; } };
const ago = (iso) => (Date.now() - Date.parse(iso)) / 3600e3;

/** Status from a usage percentage (higher = worse) unless the card sets its own. */
function meter(m) {
  const warn = m.warn ?? 60, crit = m.crit ?? 85;
  const status = m.status ?? (m.pct == null ? "unknown" : m.pct >= crit ? "crit" : m.pct >= warn ? "warn" : "ok");
  return { kind: "measured", ...m, status };
}

const collectors = {
  async netlify() {
    const out = [];
    const est = await estimateNetlifyCredits({ token: E.NETLIFY_AUTH_TOKEN, accountSlug: NETLIFY_SLUG, siteId: E.NETLIFY_SITE_ID });
    if (est.ok && est.source === "true-meter") {
      // Netlify's own meter, read live (netlify-credits.mjs readTrueCredits). No typing needed.
      const top = Object.entries(est.byMeter).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(" · ");
      out.push(meter({
        name: "Credits used (TRUE meter, live)", value: est.projectedUsed.toFixed(1), limit: est.planCredits, unit: "credits",
        pct: est.pct, warn: 50, crit: 75, link: NETLIFY_DASH, note: top,
        consequence: "Netlify DISABLES the whole site at 100% until the period resets.",
      }));
      out.push(meter({
        name: "Daily burn (spike detector)", value: est.daily.slice(-1)[0]?.total.toFixed(1) ?? "?", unit: `credits on ${est.daily.slice(-1)[0]?.date ?? "?"} · ${est.burnPerDay.toFixed(1)}/day typical`,
        status: est.spike ? "crit" : "ok", note: est.spike ? est.spikeDetail : "Alarm fires when a day burns 5x its trailing median (the 2026-10-02 flood shape).",
      }));
    } else {
    const man = readManual().netlify;
    out.push(meter(man?.used != null ? {
      name: "Credits used (TRUE meter, typed in)", value: man.used, limit: man.cap, unit: "credits",
      pct: (man.used / man.cap) * 100, kind: "manual", warn: 50, crit: 75,
      note: `Read ${ago(man.at).toFixed(1)}h ago.${ago(man.at) > 24 ? " STALE: re-read the dashboard." : ""} No API exposes this number.`,
      link: NETLIFY_DASH, consequence: "Netlify DISABLES the whole site at 100% until the period resets.",
    } : { name: "Credits used (TRUE meter)", status: "unknown", kind: "manual", note: "Live meter unavailable; type the dashboard number in below.", link: NETLIFY_DASH }));
    }
    if (est.ok) {
      out.push(meter({
        name: "Site status", kind: "measured", status: est.exceeded ? "crit" : "ok",
        value: est.exceeded ? `DISABLED since ${String(est.exceededAt).slice(0, 16)}Z` : "serving",
        consequence: "Every page returns 503 while disabled.",
      }));
      if (est.source !== "true-meter") out.push(meter({
        name: "Credit model (baseline only)", value: Math.round(est.projectedUsed), limit: est.planCredits, unit: "credits",
        pct: est.pct, kind: "estimate", note: "Models compute from bandwidth. Accurate for drift, BLIND to bursts (missed 2026-10-02).",
      }));
      out.push(meter({
        name: "Production deploys this period", value: est.deploys, unit: `deploys = ${est.deployCredits} credits`,
        pct: (est.deployCredits / est.planCredits) * 100, warn: 25, crit: 40,
        note: `Period ${String(est.periodStart).slice(0, 10)} -> ${String(est.periodEnd).slice(0, 10)} (${est.daysRemaining?.toFixed(1)}d to reset). Each src/ merge = 15 credits.`,
      }));
    }
    return out;
  },

  async cloudflare() {
    const now = new Date(), day = new Date(now - 24 * 3600e3).toISOString(), hour = new Date(now - 3600e3).toISOString();
    const z = await cf(`{viewer{zones(filter:{zoneTag:"${CF_ZONE}"}){
      d:httpRequestsAdaptiveGroups(limit:20,filter:{datetime_geq:"${day}",datetime_leq:"${now.toISOString()}"}){count dimensions{cacheStatus} avg{originResponseDurationMs}}
      h:httpRequestsAdaptiveGroups(limit:1,orderBy:[count_DESC],filter:{datetime_geq:"${hour}",datetime_leq:"${now.toISOString()}"}){count dimensions{clientIP}}
      ht:httpRequestsAdaptiveGroups(limit:1,filter:{datetime_geq:"${hour}",datetime_leq:"${now.toISOString()}"}){count}}}}`);
    const total = z.d.reduce((s, r) => s + r.count, 0);
    const hits = z.d.filter((r) => r.dimensions.cacheStatus === "hit").reduce((s, r) => s + r.count, 0);
    const originSec = z.d.reduce((s, r) => s + (r.count * Math.max(0, r.avg.originResponseDurationMs ?? 0)) / 1000, 0);
    const credits = (originSec / 3600) * 10; // 1 GB function, 10 credits per GB-hour; lower bound
    const top = z.h[0], hourTotal = z.ht[0]?.count ?? 0;
    const hitPct = total ? (hits / total) * 100 : 0;
    return [
      meter({
        name: "Origin compute, last 24h (lower bound)", value: Math.round(originSec), unit: `origin-seconds = ~${credits.toFixed(1)} credits`,
        pct: (credits / (1000 / 30)) * 100, warn: 50, crit: 100,
        note: "Measured from Cloudflare time-to-first-byte. % is against an even 33 credits/day pace for the whole account.",
      }),
      meter({
        name: "Busiest single IP, last 60 min", value: top?.count ?? 0, unit: `requests (${((top?.count ?? 0) / 3600).toFixed(2)}/s) of ${hourTotal}`,
        status: (top?.count ?? 0) > 600 ? "crit" : (top?.count ?? 0) > 200 ? "warn" : "ok",
        note: "Flood detector. The 2026-10-02 flood was ONE IP at ~12,000/hour. A per-IP rate-limit rule at Cloudflare stops this.",
      }),
      meter({
        name: "Edge cache hit ratio, last 24h", value: `${hitPct.toFixed(1)}%`, unit: `${hits} of ${total} requests`,
        status: hitPct < 15 ? "crit" : hitPct < 40 ? "warn" : "ok",
        note: "Higher is better: every cache hit costs Netlify nothing. Was 3% on 2026-10-01.",
      }),
    ];
  },

  async supabase() {
    const [[db], [st], [conn], [users], auth, proj, eg] = await Promise.all([
      sql("select pg_database_size(current_database())/1048576.0 mb"),
      sql("select coalesce(sum((metadata->>'size')::bigint),0)/1048576.0 mb from storage.objects"),
      sql("select count(*) n, (select setting::int from pg_settings where name='max_connections') max from pg_stat_activity"),
      sql("select count(*) n from auth.users"),
      json(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}/config/auth`, { headers: { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}` } }),
      json(`https://api.supabase.com/v1/projects/${E.SUPABASE_PROJECT_REF}`, { headers: { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}` } }),
      getEgressStatus(sb).catch(() => ({})),
    ]);
    const builtInSmtp = !auth.smtp_host;
    return [
      meter({ name: "Project status", value: proj.status, status: proj.status === "ACTIVE_HEALTHY" ? "ok" : "crit",
        note: "Free projects PAUSE after 7 days with no API activity. Crons keep it awake only while they run." }),
      meter({ name: "Database size (never resets)", value: Number(db.mb).toFixed(0), limit: 500, unit: "MB", pct: (db.mb / 500) * 100, warn: 70, crit: 85,
        consequence: "Read-only mode at the cap: no new users, sends, news.", note: "Biggest table is news_items." }),
      meter({ name: "Egress this cycle", value: eg.usedMb != null ? (eg.usedMb / 1000).toFixed(2) : "?", limit: BUDGET_GB, unit: "GB",
        pct: eg.pct != null ? eg.pct * 100 : null, kind: "estimate", consequence: "Project RESTRICTED at the cap (2026-07-16 outage).",
        note: "Model from transmit counters x0.497. Ground truth: Supabase dashboard -> Usage." }),
      meter({ name: "Storage", value: Number(st.mb).toFixed(0), limit: 1024, unit: "MB", pct: (st.mb / 1024) * 100 }),
      meter({ name: "DB connections now", value: conn.n, limit: conn.max, pct: (conn.n / conn.max) * 100,
        note: "A flood of uncached renders can exhaust these; pages then hang to the 30s timeout." }),
      meter({ name: "Auth users (MAU cap 50,000)", value: users.n, limit: 50000, pct: (users.n / 50000) * 100 }),
      meter({ name: "Auth emails (signup / reset)", kind: "config", value: `${auth.rate_limit_email_sent}/hour`,
        status: builtInSmtp && auth.rate_limit_email_sent <= 4 ? "crit" : "ok",
        note: builtInSmtp ? "Built-in SMTP: the WHOLE PLATFORM can send this many per hour. More signups = silent failures. Fix: point Auth SMTP at Resend." : "Custom SMTP configured." }),
    ];
  },

  async github() {
    const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const [cache, repo, runs] = await Promise.all([
      gh("/actions/cache/usage"), gh(""),
      gh(`/actions/workflows/cron-hourly.yml/runs?event=schedule&per_page=1&created=>=${since}`),
    ]);
    const idleDays = (Date.now() - Date.parse(repo.pushed_at)) / 86400e3;
    const delivered = (runs.total_count / 84) * 100; // cron-hourly is `0 */2 * * *` = 12/day
    return [
      meter({ name: "Days since last push", value: idleDays.toFixed(1), limit: 60, unit: "days", pct: (idleDays / 60) * 100, warn: 50, crit: 80,
        consequence: "GitHub DISABLES every scheduled workflow in a public repo after 60 days without activity." }),
      meter({ name: "Scheduled cron delivery, 7d", value: `${runs.total_count} of 84`, unit: "runs (cron-hourly)",
        status: delivered < 50 ? "warn" : "ok", note: "GitHub delays/drops schedules under load. Never use it as a fast alarm." }),
      meter({ name: "Actions cache", value: (cache.active_caches_size_in_bytes / 1e9).toFixed(2), limit: 10, unit: "GB",
        pct: (cache.active_caches_size_in_bytes / 1e10) * 100 }),
    ];
  },

  async pipelines() {
    const { data } = await sb.from("scraper_runs").select("source,status,notes,error_message")
      .gte("started_at", new Date(Date.now() - 48 * 3600e3).toISOString()).limit(5000);
    const rows = data ?? [];
    const sources = new Set(rows.map((r) => r.source));
    const failing = new Set(rows.filter((r) => r.status === "error").map((r) => r.source));
    const aiDry = rows.filter((r) => /circuit breaker|providers exhausted|NONE-ANSWERED|429/i.test(`${r.notes} ${r.error_message}`)).length;
    return [
      meter({ name: "Cron sources with errors (48h)", value: `${failing.size} of ${sources.size}`, pct: (failing.size / Math.max(1, sources.size)) * 100,
        warn: 8, crit: 20, note: [...failing].slice(0, 8).join(", ") }),
      meter({ name: "Free AI pool exhaustion events (48h)", value: aiDry, status: aiDry > 10 ? "crit" : aiDry > 3 ? "warn" : "ok",
        note: "Runs that stopped because every free provider was rate-limited or out of quota." }),
    ];
  },

  async people() {
    const [[u], [p], [fb], [mt]] = await Promise.all([
      sql("select count(*) n, count(*) filter (where coalesce(state,'')='') nostate from profiles"),
      sql("select count(distinct user_id) n from push_subscriptions"),
      sql("select count(*) filter (where status='open') open, min(created_at) filter (where status='open') oldest from feedback_reports"),
      sql("select count(*) filter (where meeting_at < now()+interval '7 days') soon, count(*) n from municipal_meetings where moderation_status='pending_review' and meeting_at>=now()"),
    ]);
    const env = await nf(`/accounts/${NETLIFY_SLUG}/env?site_id=${E.NETLIFY_SITE_ID}`);
    const keys = new Set(env.map((e) => e.key));
    const providers = ["RESEND_API_KEY", "BREVO_API_KEY", "MAILJET_API_KEY", "MAILERSEND_API_KEY"].filter((k) => keys.has(k));
    return [
      meter({ name: "Feedback emails reach the owner", kind: "config", value: keys.has("OWNER_EMAIL") ? "yes" : "NO — OWNER_EMAIL unset in Netlify",
        status: keys.has("OWNER_EMAIL") ? "ok" : "crit", note: "Without it every feedback email is silently skipped (in-app notice still lands)." }),
      meter({ name: "Email providers wired", kind: "config", value: `${providers.length} of 4`, unit: providers.map((k) => k.split("_")[0]).join(", "),
        status: providers.length < 2 ? "warn" : "ok", note: "Router supports Brevo 300/d, Mailjet 200/d, Resend 100/d, MailerSend 100/d. Only wired ones count." }),
      meter({ name: "Open feedback reports", value: fb.open, status: fb.open > 0 && ago(fb.oldest) > 72 ? "warn" : "ok",
        note: fb.oldest ? `Oldest open: ${String(fb.oldest).slice(0, 10)}` : "" }),
      meter({ name: "Upcoming meetings awaiting approval", value: mt.n, unit: `(${mt.soon} within 7 days)`,
        status: mt.soon > 0 ? "crit" : mt.n > 0 ? "warn" : "ok", note: "Unapproved meetings are not on the calendar and notify nobody." }),
      meter({ name: "Users reachable by push", value: `${p.n} of ${u.n}`, pct: 100 - (p.n / Math.max(1, u.n)) * 100, warn: 70, crit: 90,
        note: "% shown is the UNREACHED share." }),
      meter({ name: "Users with no state set", value: `${u.nostate} of ${u.n}`, pct: (u.nostate / Math.max(1, u.n)) * 100, warn: 20, crit: 40,
        note: "They get the national digest but no home-state alerts." }),
    ];
  },

  async domain() {
    const d = await json("https://rdap.publicinterestregistry.org/rdap/domain/ikratom.org");
    const exp = d.events.find((e) => e.eventAction === "expiration")?.eventDate;
    const days = (Date.parse(exp) - Date.now()) / 86400e3;
    return [meter({ name: "ikratom.org registration", value: `${Math.round(days)} days left`, unit: `(expires ${exp?.slice(0, 10)})`,
      status: days < 14 ? "crit" : days < 60 ? "warn" : "ok", note: "Registrar: Cloudflare. Confirm auto-renew + a valid card." })];
  },
};

let cache = { at: 0, body: null };
async function collect() {
  const groups = await Promise.all(Object.entries(collectors).map(async ([group, fn]) => {
    try { return (await fn()).map((m) => ({ group, ...m })); }
    catch (e) { return [{ group, name: `${group} collector`, status: "unknown", kind: "measured", value: "ERROR", note: e.message }]; }
  }));
  const meters = groups.flat();
  const rank = { crit: 0, warn: 1, unknown: 2, ok: 3 };
  return { at: new Date().toISOString(), meters, risks: meters.filter((m) => m.status === "crit" || m.status === "warn").sort((a, b) => rank[a.status] - rank[b.status]) };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>iKratom limits</title><style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#14171c;--mute:#5d6673;--line:#e3e6eb;--ok:#1a7f4b;--warn:#b26b00;--crit:#c0262d;--unk:#6b7280}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--ink:#e8eaee;--mute:#9aa3ae;--line:#272b33;--ok:#3fb67a;--warn:#e0a03a;--crit:#ef5b61;--unk:#8b93a0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1180px;margin:0 auto;padding:20px 16px 60px}h1{font-size:20px;margin:0}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:26px 0 10px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between}button{font:inherit;padding:7px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:10px}.card{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--unk);border-radius:10px;padding:12px 14px}
.card.ok{border-left-color:var(--ok)}.card.warn{border-left-color:var(--warn)}.card.crit{border-left-color:var(--crit)}
.top{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.name{font-weight:600}.badge{font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--line);color:var(--mute);white-space:nowrap}
.val{font-size:20px;font-weight:650;margin:6px 0 2px;font-variant-numeric:tabular-nums}.unit{font-size:12px;color:var(--mute);font-weight:400}
.bar{height:6px;border-radius:9px;background:var(--line);overflow:hidden;margin:6px 0}.bar i{display:block;height:100%;background:var(--unk)}
.ok .bar i{background:var(--ok)}.warn .bar i{background:var(--warn)}.crit .bar i{background:var(--crit)}
.note{font-size:12px;color:var(--mute)}.cons{font-size:12px;margin-top:4px}a{color:inherit}
.risks{display:flex;flex-direction:column;gap:6px}.risk{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 12px;display:flex;gap:10px;align-items:baseline}
.dot{width:9px;height:9px;border-radius:9px;flex:none;background:var(--unk)}.dot.crit{background:var(--crit)}.dot.warn{background:var(--warn)}
form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
input{font:inherit;width:110px;padding:6px 8px;border-radius:7px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
</style></head><body><main>
<header><div><h1>iKratom: every ceiling, one page</h1><div class="note" id="at">loading...</div></div><button id="r">Refresh</button></header>
<h2>Top risks</h2><div class="risks" id="risks"></div>
<h2>Netlify true credit meter (no API exists: type it in)</h2>
<form id="f"><span>Used</span><input name="used" type="number" step="0.1" min="0" required><span>of</span><input name="cap" type="number" min="1" value="1000" required>
<button>Save reading</button><a class="note" target="_blank" rel="noreferrer" href="${NETLIFY_DASH}">Open Netlify "Credit usage breakdown"</a></form>
<div id="groups"></div></main><script>
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const card=m=>'<div class="card '+m.status+'"><div class="top"><span class="name">'+esc(m.name)+'</span><span class="badge">'+esc(m.kind)+'</span></div>'+
 '<div class="val">'+esc(m.value??"?")+(m.limit!=null?' <span class="unit">/ '+esc(m.limit)+'</span>':'')+' <span class="unit">'+esc(m.unit??"")+'</span></div>'+
 (m.pct!=null?'<div class="bar"><i style="width:'+Math.min(100,Math.max(2,m.pct)).toFixed(1)+'%"></i></div>':'')+
 (m.consequence?'<div class="cons">At the limit: '+esc(m.consequence)+'</div>':'')+(m.note?'<div class="note">'+esc(m.note)+'</div>':'')+
 (m.link?'<div class="note"><a target="_blank" rel="noreferrer" href="'+esc(m.link)+'">open source</a></div>':'')+'</div>';
async function load(fresh){document.getElementById("at").textContent="reading every provider...";
 const d=await (await fetch("/api/readings"+(fresh?"?fresh=1":""))).json();
 document.getElementById("at").textContent="Read "+new Date(d.at).toLocaleString();
 document.getElementById("risks").innerHTML=d.risks.length?d.risks.map(m=>'<div class="risk"><span class="dot '+m.status+'"></span><span><b>'+esc(m.group)+'</b> · '+esc(m.name)+': '+esc(m.value)+' '+esc(m.unit??"")+'</span></div>').join(""):'<div class="note">Nothing at warning level.</div>';
 const by={};d.meters.forEach(m=>(by[m.group]??=[]).push(m));
 document.getElementById("groups").innerHTML=Object.entries(by).map(([g,ms])=>'<h2>'+esc(g)+'</h2><div class="grid">'+ms.map(card).join("")+'</div>').join("");}
document.getElementById("r").onclick=()=>load(true);
document.getElementById("f").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);
 await fetch("/api/manual",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({used:+f.get("used"),cap:+f.get("cap")})});load(true);};
load(false);
</script></body></html>`;

http.createServer(async (req, res) => {
  try {
    // Same threat model as desktop/operator: a hostile page open in your
    // browser can fire requests at localhost. A foreign Host header means DNS
    // rebinding; a non-JSON POST means a plain HTML form (no CORS preflight).
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && !(req.headers["content-type"] ?? "").startsWith("application/json")) { res.writeHead(415); return res.end(); }
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(PAGE); }
    if (req.method === "GET" && url.pathname === "/api/readings") {
      if (url.searchParams.has("fresh") || Date.now() - cache.at > 60_000) cache = { at: Date.now(), body: JSON.stringify(await collect()) };
      res.writeHead(200, { "content-type": "application/json" }); return res.end(cache.body);
    }
    if (req.method === "POST" && url.pathname === "/api/manual") {
      let raw = ""; for await (const c of req) { raw += c; if (raw.length > 1000) throw new Error("too large"); }
      const { used, cap } = JSON.parse(raw);
      if (!Number.isFinite(used) || !Number.isFinite(cap) || used < 0 || cap <= 0) { res.writeHead(400); return res.end("bad numbers"); }
      const m = readManual(); m.netlify = { used, cap, at: new Date().toISOString() };
      fs.mkdirSync(path.dirname(MANUAL_FILE), { recursive: true });
      fs.writeFileSync(MANUAL_FILE, JSON.stringify(m, null, 2));
      cache.at = 0; res.writeHead(204); return res.end();
    }
    res.writeHead(404); res.end();
  } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, "127.0.0.1", () => console.log(`limits console: http://127.0.0.1:${PORT}`));
