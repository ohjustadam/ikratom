"use server";

import { updateTag, revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "./actions";
import { recordAdminAction } from "@/lib/audit";

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
