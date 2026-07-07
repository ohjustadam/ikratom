"use server";

import { updateTag, revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { DISPATCHABLE_WORKFLOW_FILES } from "@/lib/dispatchable-workflows";

/**
 * Console server actions — the "nuclear option" admin surface for
 * remote troubleshooting from any browser.
 *
 * Three capabilities:
 *   1. runSqlQuery() — direct Postgres query via service-role client.
 *      Owner-only. Read queries (SELECT) execute directly. Writes
 *      (INSERT/UPDATE/DELETE) require an `acknowledge` flag and are
 *      audit-logged. Hard-blocked: DROP, TRUNCATE, ALTER on auth
 *      schema, anything touching auth.users.
 *   2. triggerCron() — invoke an /api/cron/* endpoint server-side with
 *      the CRON_SECRET. Admin-only. Audit-logged.
 *   3. invalidateCache() — flush a named cache tag or revalidate a
 *      specific path. Admin-only.
 *
 * Safety posture:
 *   - All three call getAdminContext() and check role server-side
 *   - SQL writes additionally require ctx.isOwner
 *   - SQL has a parse-side blocklist for destructive ops
 *   - Every action call writes a row to admin_audit_log
 *   - Service-role client is constructed per-call, never cached
 *     globally (no risk of leaking through Next.js render cache)
 */

// ── SQL console ────────────────────────────────────────────────

// Hard-blocked patterns. We don't try to parse SQL — we just refuse
// anything containing these tokens. False-positives are fine; the
// console isn't for clever bulk-rewrite work.
const BLOCKED_TOKENS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\s+auth\./i,
  /\bUPDATE\s+auth\./i,
  /\bALTER\s+TABLE\s+auth\./i,
  /\bGRANT\s+/i,
  /\bREVOKE\s+/i,
  /\bCREATE\s+ROLE\b/i,
  /\bALTER\s+ROLE\b/i,
  // Any reference to the auth schema. admin_exec_sql is SECURITY DEFINER and
  // bypasses RLS, so `SELECT ... FROM auth.users` would leak every user's email
  // + bcrypt password hash. The console never needs the auth schema. (Blocks
  // reads too — the pre-existing DELETE/UPDATE/ALTER auth. rules only caught
  // writes.) Security audit 2026-07-06.
  /\bauth\s*\.\s*\w/i,
];

// Mutation prefixes — these require the `acknowledge` flag.
const MUTATION_RE = /^\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT)\b/i;

export type SqlResult =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; elapsedMs: number }
  | { ok: false; error: string };

export async function runSqlQuery(input: {
  query: string;
  acknowledge?: boolean;
}): Promise<SqlResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };
  // Break-glass OWNER tool: admin_exec_sql is SECURITY DEFINER and bypasses RLS,
  // so a non-owner admin could otherwise read auth.users (emails + bcrypt
  // hashes) or any user's private profile columns via raw SELECT. Reads AND
  // writes now require owner (previously only writes did). Security audit
  // 2026-07-06. Admins have the AI editor / master-edit / dashboards for
  // legitimate, PII-minimized reads.
  if (!ctx.isOwner) return { ok: false, error: "The SQL console is owner-only — it bypasses row-level security." };

  const sql = (input.query ?? "").trim();
  if (!sql) return { ok: false, error: "Empty query." };
  if (sql.length > 50_000) return { ok: false, error: "Query too long (max 50,000 chars)." };

  // Single-statement only — refuse multi-statement input. Postgres
  // can dispatch multiple statements in one round trip; we don't
  // want to.
  const trimmed = sql.replace(/;\s*$/, "");
  if (/;\s*\S/.test(trimmed)) {
    return { ok: false, error: "Multi-statement queries not allowed. Run one statement at a time." };
  }

  // Hard blocklist
  for (const re of BLOCKED_TOKENS) {
    if (re.test(sql)) {
      return { ok: false, error: `Query contains blocked pattern: ${re.source}` };
    }
  }

  const isMutation = MUTATION_RE.test(sql);
  if (isMutation) {
    if (!ctx.isOwner) {
      return { ok: false, error: "Mutations require owner role (not just admin)." };
    }
    if (!input.acknowledge) {
      return { ok: false, error: "Mutation requires `acknowledge: true` (the confirm dialog)." };
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "Service-role env not configured." };
  const sb = createServiceClient(url, key, { auth: { persistSession: false } });

  const t0 = Date.now();
  // Use Postgres's REST endpoint via an exec_sql RPC. We require this
  // function to exist (created by migration 0160 below). If it
  // doesn't, the call returns a clear error.
  const { data, error } = await sb.rpc("admin_exec_sql", { p_sql: sql });
  const elapsedMs = Date.now() - t0;

  if (error) {
    await recordAdminAction({
      action: "console.sql_error",
      targetType: "user",
      targetId: ctx.userId,
      details: { query_preview: sql.slice(0, 500), error: error.message, elapsed_ms: elapsedMs },
    });
    return { ok: false, error: error.message };
  }

  // The RPC returns rows as a jsonb array (see migration). Cap output.
  const allRows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const MAX_ROWS = 500;
  const truncated = allRows.length > MAX_ROWS;
  const rows = truncated ? allRows.slice(0, MAX_ROWS) : allRows;

  await recordAdminAction({
    action: isMutation ? "console.sql_mutation" : "console.sql_read",
    targetType: "user",
    targetId: ctx.userId,
    details: {
      query_preview: sql.slice(0, 500),
      row_count: allRows.length,
      elapsed_ms: elapsedMs,
      mutation: isMutation,
    },
  });

  return { ok: true, rows, rowCount: allRows.length, truncated, elapsedMs };
}

// ── Manual cron trigger ────────────────────────────────────────

export type CronTriggerResult =
  | { ok: true; status: number; body: string; elapsedMs: number }
  | { ok: false; error: string };

const CRON_ENDPOINTS = ["daily-sync", "fire-waves", "reverify-local-officials"] as const;
type CronEndpoint = typeof CRON_ENDPOINTS[number];

export async function triggerCron(endpoint: CronEndpoint): Promise<CronTriggerResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  if (!CRON_ENDPOINTS.includes(endpoint)) {
    return { ok: false, error: `Unknown endpoint. Allowed: ${CRON_ENDPOINTS.join(", ")}` };
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET not configured." };

  const base = process.env.APP_URL ?? "https://www.ikratom.org";
  const url = `${base}/api/cron/${endpoint}`;
  const t0 = Date.now();

  try {
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    const elapsedMs = Date.now() - t0;
    const body = (await r.text()).slice(0, 2000);

    await recordAdminAction({
      action: "console.cron_trigger",
      targetType: "user",
      targetId: ctx.userId,
      details: { endpoint, status: r.status, elapsed_ms: elapsedMs },
    });

    return { ok: true, status: r.status, body, elapsedMs };
  } catch (e) {
    return { ok: false, error: `Trigger failed: ${(e as Error).message}` };
  }
}

// ── GitHub Actions workflow dispatch ───────────────────────────
//
// Generalizes the proven, already-audited triggerCloudResolution() pattern
// (src/modules/local-reps/actions.ts) so the owner can run ANY cron pipeline
// from inside the site — closing "GitHub Actions workflows aren't exposed
// here". Token: GITHUB_DISPATCH_TOKEN (fine-grained PAT, Actions: read+write,
// this repo only) in server env — never NEXT_PUBLIC, never returned to client.
// The DISPATCHABLE_WORKFLOW_FILES allowlist is the security boundary; an
// arbitrary filename is refused before any network call.

export type WorkflowDispatchResult =
  | { ok: true; runsUrl: string }
  | { ok: false; error: string };

export async function dispatchWorkflow(
  workflowFile: string,
): Promise<WorkflowDispatchResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  if (!DISPATCHABLE_WORKFLOW_FILES.includes(workflowFile)) {
    return { ok: false, error: `Workflow "${workflowFile}" is not dispatchable.` };
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_DISPATCH_REPO || "ohjustadam/ikratom";
  if (!token) {
    return { ok: false, error: "GITHUB_DISPATCH_TOKEN not set (fine-grained PAT, Actions: read+write) in the server env." };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, error: "GITHUB_DISPATCH_REPO is malformed." };

  // A run takes minutes; stacking many is pointless and churns Actions minutes.
  if (!(await checkRateLimit(`workflow-dispatch:${ctx.userId}`, 12, 600))) {
    return { ok: false, error: "Too many workflow runs in 10 minutes — give the current ones a moment." };
  }

  // NO user-supplied inputs. Every dispatchable workflow has sensible input
  // DEFAULTS, and the two that read inputs interpolate them into `run:` shells
  // (news-backfill-burst, cron-localreps-cloud) — a script-injection sink. We
  // dispatch with ref only; the workflows use their defaults. (Security audit
  // 2026-07-06 — the previous `inputs` param let an admin inject shell commands
  // into a runner carrying SUPABASE_SERVICE_ROLE_KEY. Defense-in-depth: those
  // workflows now also read inputs via env: indirection, not inline `${{ }}`.)
  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "iKratom-admin",
        },
        body: JSON.stringify({ ref: "main" }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return { ok: false, error: `Couldn't reach GitHub: ${(e as Error).message}` };
  }

  if (res.status === 204) {
    try {
      await recordAdminAction({
        action: "console.workflow_dispatch",
        targetType: "user",
        targetId: ctx.userId,
        details: { workflow: workflowFile },
      });
    } catch { /* non-fatal */ }
    return { ok: true, runsUrl: `https://github.com/${repo}/actions/workflows/${workflowFile}` };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "GitHub rejected the token — check GITHUB_DISPATCH_TOKEN has Actions: read+write on this repo." };
  }
  if (res.status === 404) {
    return { ok: false, error: "Workflow not found — it must exist on the default branch (main)." };
  }
  const body = await res.text().catch(() => "");
  return { ok: false, error: `GitHub dispatch failed (${res.status}). ${body.slice(0, 150)}` };
}

// ── Cache invalidation ─────────────────────────────────────────

const KNOWN_TAGS = ["editable-content"] as const;
type CacheTag = typeof KNOWN_TAGS[number];

export type CacheResult =
  | { ok: true; action: string }
  | { ok: false; error: string };

export async function flushCacheTag(tag: CacheTag): Promise<CacheResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  if (!KNOWN_TAGS.includes(tag)) {
    return { ok: false, error: `Unknown tag. Allowed: ${KNOWN_TAGS.join(", ")}` };
  }

  updateTag(tag);

  await recordAdminAction({
    action: "console.cache_flush_tag",
    targetType: "user",
    targetId: ctx.userId,
    details: { tag },
  });

  return { ok: true, action: `Flushed cache tag '${tag}'` };
}

export async function revalidateAdminPath(path: string): Promise<CacheResult> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin required." };

  // Bounded path syntax — refuse arbitrary URLs.
  if (!/^\/[a-zA-Z0-9_/[\]:-]{0,200}$/.test(path)) {
    return { ok: false, error: "Path must be a simple route like /support or /bills/[id]." };
  }

  try {
    revalidatePath(path);
  } catch (e) {
    return { ok: false, error: `Revalidate failed: ${(e as Error).message}` };
  }

  await recordAdminAction({
    action: "console.cache_revalidate_path",
    targetType: "user",
    targetId: ctx.userId,
    details: { path },
  });

  return { ok: true, action: `Revalidated path '${path}'` };
}
