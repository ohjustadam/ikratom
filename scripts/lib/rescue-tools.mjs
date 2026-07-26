/**
 * rescue-tools.mjs — platform probes that work when the SITE IS DOWN.
 *
 * Every function here talks DIRECTLY to a platform API. Nothing routes through
 * www.ikratom.org, because in an outage the site is exactly what you can't
 * reach. That constraint is the whole design (see private/RESCUE_CONSOLE_PLAN.md).
 *
 * Two outages proved this is possible:
 *   2026-07-16 — a RESTRICTED Supabase project still answers the Management API
 *                SQL endpoint (the same door `npm run db:push` uses) with full
 *                read/write, while PostgREST/Auth/Storage are blocked.
 *   2026-07-22 — a SOFT-BLOCKED Vercel account still answers its full REST API
 *                while every deployment returns HTTP 402.
 *
 * All probes are READ-ONLY and fail soft: a probe that throws would take down
 * the diagnosis, which is the one thing that must keep working.
 */

const TIMEOUT_MS = 25_000;

/** fetch with a timeout, never throws — returns {ok, status, body, error}. */
async function safeFetch(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text();
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    return { ok: res.ok, status: res.status, body, headers: res.headers, error: null };
  } catch (e) {
    return { ok: false, status: 0, body: null, headers: null, error: e.message };
  }
}

/** Canonical public URL — never a loopback value from local dev's APP_URL. */
export function siteUrl() {
  const raw = (process.env.APP_URL || "").replace(/\/+$/, "");
  const isLocal = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(raw);
  return (process.env.WATCHDOG_SITE_URL || (raw && !isLocal ? raw : "https://www.ikratom.org")).replace(/\/+$/, "");
}

/** Is the public site actually serving? The cause-agnostic check. */
export async function probeSite() {
  const url = siteUrl();
  const r = await safeFetch(url, { redirect: "follow", headers: { "User-Agent": "ikratom-rescue/1.0" } });
  const vercelError = r.headers?.get?.("x-vercel-error") ?? null;
  return {
    name: "site",
    url,
    ok: r.ok,
    status: r.status,
    vercelError,
    detail: r.error ? `unreachable: ${r.error}` : `HTTP ${r.status}${vercelError ? ` (${vercelError})` : ""}`,
  };
}

/** Vercel account + team state. Names the blocked resource when blocked. */
export async function probeVercel() {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { name: "vercel", ok: null, detail: "VERCEL_TOKEN not set — skipped" };
  const h = { Authorization: `Bearer ${token}` };
  const teamId = process.env.VERCEL_TEAM_ID || "team_ZGMOvQ3FPi6lHFerlrOk6cvt";

  const u = await safeFetch("https://api.vercel.com/v2/user", { headers: h });
  const t = await safeFetch(`https://api.vercel.com/v2/teams/${teamId}`, { headers: h });

  const limited = u.ok ? !!u.body?.user?.limited : null;
  const soft = t.ok ? t.body?.softBlock ?? null : null;
  const problems = [];
  if (limited) problems.push("account LIMITED (usage cap hit)");
  if (soft) {
    const when = soft.blockedAt ? new Date(soft.blockedAt).toISOString().slice(0, 16).replace("T", " ") : "unknown";
    problems.push(`SOFT-BLOCK ${soft.reason} on ${soft.blockedDueToOverageType ?? "unknown"} since ${when} UTC`);
  }
  if (t.ok && t.body?.blocked) problems.push("team BLOCKED");

  return {
    name: "vercel",
    ok: problems.length === 0 && u.ok,
    plan: t.ok ? t.body?.billing?.plan ?? "?" : "?",
    detail: problems.length ? problems.join(" · ") : (u.ok ? "healthy" : `API ${u.status}`),
  };
}

/** Most recent production deployments — is there something to roll back to? */
export async function probeDeployments(limit = 5) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { name: "deployments", ok: null, detail: "VERCEL_TOKEN not set — skipped", items: [] };
  const r = await safeFetch(`https://api.vercel.com/v6/deployments?limit=${limit}&state=READY`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return { name: "deployments", ok: false, detail: `API ${r.status}`, items: [] };
  const items = (r.body?.deployments ?? []).map((d) => ({
    created: new Date(d.created).toISOString().slice(0, 16).replace("T", " "),
    state: d.readyState ?? d.state,
    url: d.url,
  }));
  return { name: "deployments", ok: items.length > 0, detail: `${items.length} READY`, items };
}

/**
 * Supabase Management API SQL — the door that stays open when the project
 * gateway is restricted. This is the single most valuable probe in an outage.
 */
export async function sqlViaManagementApi(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF
    || (process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0] : null);
  if (!token || !ref) return { ok: false, error: "SUPABASE_ACCESS_TOKEN or project ref missing", rows: null };
  const r = await safeFetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${typeof r.body === "string" ? r.body.slice(0, 200) : JSON.stringify(r.body).slice(0, 200)}`, rows: null };
  return { ok: true, error: null, rows: Array.isArray(r.body) ? r.body : [] };
}

/** Can we reach the DB at all, and by which door? */
export async function probeDatabase() {
  const mgmt = await sqlViaManagementApi("select 1 as ok");
  // The PostgREST gateway is what the APP uses — it can be down while the
  // Management API is fine (that is exactly the 2026-07-16 signature).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let gateway = { ok: null, detail: "not configured" };
  if (url && key) {
    const g = await safeFetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    gateway = { ok: g.ok, detail: g.error ? `unreachable: ${g.error}` : `HTTP ${g.status}` };
  }
  return {
    name: "database",
    ok: mgmt.ok,
    detail: `management-api: ${mgmt.ok ? "OK" : `FAIL (${mgmt.error})`} · app-gateway: ${gateway.ok === null ? gateway.detail : gateway.ok ? "OK" : `DOWN (${gateway.detail})`}`,
    mgmtOk: mgmt.ok,
    gatewayOk: gateway.ok,
  };
}

/**
 * Cron health — read through the Management API so it still works when the
 * app gateway is down, which is precisely when you need it.
 */
export async function probeCrons(staleHours = 26) {
  const r = await sqlViaManagementApi(
    `select source,
            status,
            finished_at,
            round((extract(epoch from (now() - finished_at)) / 3600)::numeric, 1) as hours_ago
       from scraper_runs_latest
      order by finished_at asc nulls first
      limit 12`
  );
  if (!r.ok) return { name: "crons", ok: null, detail: `unavailable (${r.error})`, items: [] };
  const items = r.rows ?? [];
  const stale = items.filter((x) => x.hours_ago === null || Number(x.hours_ago) > staleHours);
  return {
    name: "crons",
    ok: stale.length === 0,
    detail: stale.length ? `${stale.length} stale (> ${staleHours}h): ${stale.map((s) => s.source).join(", ")}` : "all fresh",
    items,
  };
}

/** Recent GitHub Actions runs — did the automation break, or the host? */
export async function probeGithub(limit = 6) {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER || "ohjustadam";
  const repo = process.env.GITHUB_REPO_NAME || "ikratom";
  if (!token) return { name: "github", ok: null, detail: "GITHUB_TOKEN not set — skipped", items: [] };
  const r = await safeFetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=${limit}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!r.ok) return { name: "github", ok: false, detail: `API ${r.status}`, items: [] };
  const items = (r.body?.workflow_runs ?? []).map((w) => ({
    name: w.name,
    status: w.conclusion ?? w.status,
    at: (w.updated_at ?? "").slice(0, 16).replace("T", " "),
  }));
  const failed = items.filter((i) => i.status === "failure");
  return {
    name: "github",
    ok: failed.length === 0,
    detail: failed.length ? `${failed.length} recent failure(s): ${failed.map((f) => f.name).join(", ")}` : "recent runs clean",
    items,
  };
}

/** Run everything concurrently. Never throws. */
export async function runDiagnostics() {
  const [site, vercel, database, crons, github, deployments] = await Promise.all([
    probeSite().catch((e) => ({ name: "site", ok: false, detail: `probe crashed: ${e.message}` })),
    probeVercel().catch((e) => ({ name: "vercel", ok: false, detail: `probe crashed: ${e.message}` })),
    probeDatabase().catch((e) => ({ name: "database", ok: false, detail: `probe crashed: ${e.message}` })),
    probeCrons().catch((e) => ({ name: "crons", ok: null, detail: `probe crashed: ${e.message}`, items: [] })),
    probeGithub().catch((e) => ({ name: "github", ok: null, detail: `probe crashed: ${e.message}`, items: [] })),
    probeDeployments().catch((e) => ({ name: "deployments", ok: null, detail: `probe crashed: ${e.message}`, items: [] })),
  ]);
  return { site, vercel, database, crons, github, deployments };
}

/**
 * Turn probe results into a plain-English verdict + the next action.
 * This is the part that replaces "ask Claude what's wrong".
 */
export function verdict(d) {
  if (d.site.ok) {
    const warn = [];
    if (d.vercel.ok === false) warn.push(`Vercel: ${d.vercel.detail}`);
    if (d.database.gatewayOk === false) warn.push("DB gateway is down but the site is serving — likely cached pages");
    if (d.crons.ok === false) warn.push(`Crons: ${d.crons.detail}`);
    if (d.github.ok === false) warn.push(`CI: ${d.github.detail}`);
    return warn.length
      ? { headline: "SITE IS UP — but something needs attention", actions: warn }
      : { headline: "ALL CLEAR — site is up, no problems detected", actions: [] };
  }

  // Site is down. Name the cause in the order that matters.
  if (d.site.vercelError === "DEPLOYMENT_DISABLED" || d.vercel.detail?.includes("SOFT-BLOCK") || d.vercel.detail?.includes("LIMITED")) {
    return {
      headline: "SITE DOWN — Vercel has disabled the deployment (usage limit)",
      actions: [
        `Vercel says: ${d.vercel.detail}`,
        "This is NOT a code problem — your last deployment is fine.",
        "Lifting it is owner-only: wait for the usage cycle to reset, or upgrade.",
        "Your DATA IS SAFE — Supabase is a separate platform. " +
          (d.database.mgmtOk ? "Confirmed reachable via the Management API." : "Could not confirm — check SUPABASE_ACCESS_TOKEN."),
      ],
    };
  }
  if (d.database.mgmtOk === false) {
    return {
      headline: "SITE DOWN — and the database is unreachable too",
      actions: ["Check the Supabase dashboard for a restriction or outage.", `Detail: ${d.database.detail}`],
    };
  }
  if (d.database.gatewayOk === false && d.database.mgmtOk) {
    return {
      headline: "SITE DOWN — Supabase app-gateway is blocked (Management API still works)",
      actions: [
        "This is the 2026-07-16 signature: project restricted for exceeding a free-tier quota.",
        "The Management API SQL endpoint still has full read/write — data is reachable and rescuable.",
      ],
    };
  }
  return {
    headline: `SITE DOWN — ${d.site.detail}`,
    actions: [
      "Vercel and the database both look healthy, so suspect a bad deploy, DNS, or a cert.",
      d.deployments.items?.length ? `Last known-good deploy: ${d.deployments.items[0].created} (${d.deployments.items[0].url})` : "No READY deployment found.",
    ],
  };
}
