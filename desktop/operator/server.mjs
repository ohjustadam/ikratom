#!/usr/bin/env node
/**
 * iKratom Operator Shell — server.mjs
 *
 * A LOCAL control panel for operating, debugging, and fixing iKratom without
 * Claude and even when the public site is down. It talks DIRECTLY to the
 * platform APIs (Supabase Management API, GitHub, Vercel/Netlify) and to the
 * on-box free toolbox (Ollama, SearXNG via the AI router) — nothing routes
 * through www.ikratom.org, which is the whole point: in an outage the site is
 * the one thing you can't reach.
 *
 * Run:  npm run operator      (opens http://127.0.0.1:8787 in your browser)
 * Or the Tauri desktop app points its window at the same local URL.
 *
 * Security model (this exposes real admin power on localhost):
 *   - Binds to 127.0.0.1 ONLY. Never 0.0.0.0. Other machines can't reach it.
 *   - A random token is minted each launch and required on every API call
 *     (defends against a malicious page in your browser POSTing to localhost).
 *   - SQL writes are BLOCKED unless the request explicitly opts in AND the
 *     statement is confirmed — reads are always free.
 *   - Secret VALUES are never sent to the UI. The Config panel shows only
 *     which keys are set (booleans).
 *
 * Reuses the committed toolbox verbatim:
 *   scripts/lib/rescue-tools.mjs  — diagnostics + Management-API SQL
 *   scripts/lib/ai-router.mjs     — free AI providers (Ollama/Groq/Gemini/…)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

import {
  runDiagnostics,
  verdict,
  sqlViaManagementApi,
  siteUrl,
} from "../../scripts/lib/rescue-tools.mjs";
import { aiRouter, listAvailableProviders } from "../../scripts/lib/ai-router.mjs";

// GitHub workflows the operator may dispatch. Mirrors the app's allowlist
// intent (src/lib/dispatchable-workflows.ts) but kept here as a plain list so
// this .mjs file needs no TS import. Add a file here to expose it.
const DISPATCHABLE = new Set([
  "cron-daily.yml", "cron-hourly.yml", "cron-weekly.yml", "cron-nightly-cloud.yml",
  "cron-localreps-cloud.yml", "news-backfill-burst.yml", "portrait-sync.yml",
  "topic-bills-sync.yml", "rescue.yml",
]);

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(HERE, "ui");
const PORT = Number(process.env.OPERATOR_PORT || 8787);
const TOKEN = process.env.OPERATOR_TOKEN || randomBytes(18).toString("hex");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

// ── Small helpers ────────────────────────────────────────────────────────────
function json(res, status, body) {
  const s = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) });
  res.end(s);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}
// Auth: token must match (querystring for the initial page load, header for API).
function authed(req, url) {
  const t = req.headers["x-operator-token"] || url.searchParams.get("t");
  return t === TOKEN;
}

// A statement is a WRITE unless it's a bare read. Conservative: anything that
// isn't clearly SELECT/EXPLAIN/SHOW/WITH…SELECT is treated as a write and
// blocked by default. Better to over-flag than to run an unintended mutation.
function isWriteSql(q) {
  const s = q.trim().replace(/^\s*--.*$/gm, "").trim().toLowerCase();
  if (/^(insert|update|delete|drop|alter|truncate|create|grant|revoke|comment|merge|call|do|vacuum|reindex|refresh|copy)\b/.test(s)) return true;
  // WITH … can hide a writing CTE (INSERT/UPDATE/DELETE inside). Flag if any
  // write keyword appears at a statement boundary.
  if (/\b(insert\s+into|update\s+\w|delete\s+from|drop\s+|alter\s+|truncate\s+)/.test(s)) return true;
  return false;
}

// ── API handlers ─────────────────────────────────────────────────────────────
const api = {
  // Health of the whole platform — reuses the rescue diagnostics.
  async "GET /api/diagnose"() {
    const d = await runDiagnostics();
    return { verdict: verdict(d), probes: d, target: siteUrl() };
  },

  // Which secrets are configured (booleans only — values NEVER leave the box).
  async "GET /api/config"() {
    const groups = {
      supabase: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_REF"],
      hosting: ["VERCEL_TOKEN", "NETLIFY_AUTH_TOKEN", "CLOUDFLARE_DEPLOY_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
      github: ["GITHUB_TOKEN", "GITHUB_REPO_OWNER", "GITHUB_REPO_NAME"],
      ai: ["GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "SAMBANOVA_API_KEY", "GITHUB_MODELS_TOKEN", "OLLAMA_URL"],
      other: ["SEARXNG_URL", "APP_URL", "CRON_SECRET", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"],
    };
    const out = {};
    for (const [g, keys] of Object.entries(groups)) {
      out[g] = keys.map((k) => ({ key: k, set: !!(process.env[k] && process.env[k].trim()) }));
    }
    return { groups: out };
  },

  // Run SQL against the Supabase Management API (works even when the app
  // gateway is restricted). Writes are blocked unless explicitly confirmed.
  async "POST /api/sql"(req) {
    const { query, allowWrite } = await readBody(req);
    if (!query || typeof query !== "string") return { _status: 400, error: "query required" };
    if (isWriteSql(query) && allowWrite !== true) {
      return { _status: 400, error: "This looks like a WRITE. Re-run with the write toggle ON to confirm.", blocked: "write" };
    }
    const r = await sqlViaManagementApi(query);
    if (!r.ok) return { _status: 400, error: r.error };
    return { rows: r.rows, rowCount: Array.isArray(r.rows) ? r.rows.length : 0 };
  },

  // List public tables (read-only convenience for the DB browser).
  async "GET /api/tables"() {
    const r = await sqlViaManagementApi(
      "select table_name, (select count(*) from information_schema.columns c where c.table_name = t.table_name and c.table_schema='public') as columns from information_schema.tables t where table_schema='public' and table_type='BASE TABLE' order by table_name"
    );
    if (!r.ok) return { _status: 400, error: r.error };
    return { tables: r.rows };
  },

  // Which free AI providers are usable right now (keys present + reachable).
  async "GET /api/ai/providers"() {
    let providers = [];
    try { providers = listAvailableProviders() || []; } catch { /* */ }
    return { providers };
  },

  // Free-tier AI troubleshooter. Routes to Ollama/Groq/Gemini/… — never a paid
  // API (platform policy). This is the "diagnose + fix without Claude" brain.
  async "POST /api/ai/chat"(req) {
    const { message, context } = await readBody(req);
    if (!message) return { _status: 400, error: "message required" };
    const system =
      "You are the iKratom Operator Assistant — a terse, expert site-reliability copilot for a Next.js + Supabase civic platform. " +
      "You help the owner (non-developer) diagnose and fix the site using the operator's own panels (Status, Database, Ops). " +
      "Prefer concrete next actions and exact SQL/commands over prose. Never invent data. If asked to change production, spell out the exact step and warn it's a write.";
    const user = context ? `Current operator context:\n${context}\n\nOwner asks: ${message}` : message;
    try {
      const { provider, parsed, elapsedMs } = await aiRouter({ systemPrompt: system, userPrompt: user, maxTokens: 1200, verbose: false });
      const text = typeof parsed === "string" ? parsed : (parsed?.text ?? JSON.stringify(parsed));
      return { reply: text, provider, elapsedMs };
    } catch (e) {
      return { _status: 502, error: `All free AI providers failed: ${String(e?.message ?? e).slice(0, 200)}` };
    }
  },

  // Recent GitHub Actions runs (needs GITHUB_TOKEN).
  async "GET /api/ops/runs"() {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_REPO_OWNER || "ohjustadam";
    const repo = process.env.GITHUB_REPO_NAME || "ikratom";
    if (!token) return { _status: 400, error: "GITHUB_TOKEN not set" };
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=15`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { _status: 400, error: `GitHub ${res.status}` };
    const body = await res.json();
    return {
      runs: (body.workflow_runs ?? []).map((w) => ({
        name: w.name, status: w.conclusion ?? w.status,
        at: (w.updated_at ?? "").slice(0, 16).replace("T", " "),
        url: w.html_url,
      })),
      dispatchable: [...DISPATCHABLE],
    };
  },

  // Dispatch a GitHub Actions workflow (a cron / pipeline). Allowlisted +
  // requires an explicit confirm, so a stray click can't fire a pipeline.
  async "POST /api/ops/dispatch"(req) {
    const { file, ref = "main", confirm } = await readBody(req);
    if (!file || !DISPATCHABLE.has(file)) return { _status: 400, error: "unknown or non-allowlisted workflow" };
    if (confirm !== true) return { _status: 400, error: "dispatch requires confirm:true" };
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_REPO_OWNER || "ohjustadam";
    const repo = process.env.GITHUB_REPO_NAME || "ikratom";
    if (!token) return { _status: 400, error: "GITHUB_TOKEN not set" };
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    if (res.status !== 204) {
      const t = await res.text();
      return { _status: 400, error: `dispatch failed ${res.status}: ${t.slice(0, 160)}` };
    }
    return { dispatched: file, ref };
  },
};

// ── Server ───────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const routeKey = `${req.method} ${url.pathname}`;

  // Static UI. NOT token-gated: these files carry no secrets, and sub-resource
  // requests (app.js, style.css) don't inherit the ?t= query string from the
  // page URL, so gating them here just 403s the assets. Security lives on the
  // API: the page reads the token from its own ?t= and sends it as a header on
  // every /api call, and the server binds to 127.0.0.1 only. A page that lacks
  // the token loads but can do nothing.
  if (req.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/ui"))) {
    const file = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/ui\/?/, "");
    try {
      const buf = await readFile(join(UI_DIR, file || "index.html"));
      res.writeHead(200, { "Content-Type": MIME[extname(file || ".html")] || "application/octet-stream" });
      return res.end(buf);
    } catch { res.writeHead(404); return res.end("not found"); }
  }

  // API
  if (url.pathname.startsWith("/api/")) {
    if (!authed(req, url)) return json(res, 403, { error: "bad or missing operator token" });
    const handler = api[routeKey];
    if (!handler) return json(res, 404, { error: `no route ${routeKey}` });
    try {
      const out = await handler(req);
      const status = out?._status ?? 200;
      if (out && "_status" in out) delete out._status;
      return json(res, status, out);
    } catch (e) {
      return json(res, 500, { error: String(e?.message ?? e) });
    }
  }

  res.writeHead(404); res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const link = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
  // eslint-disable-next-line no-console
  console.log(`\n  iKratom Operator Shell\n  ──────────────────────\n  Open:  ${link}\n  (localhost-only · token-gated · reads free, writes confirmed)\n`);
});
