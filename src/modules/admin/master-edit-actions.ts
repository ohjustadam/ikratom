"use server";

/**
 * Master-edit (queue #7a, owner vision): a spreadsheet-like surface over the
 * core data types with dry-run diff preview and audited apply.
 *
 * Thin server layer — ALL write safety lives in the shared entity-edit engine
 * (column whitelist, validation, user-scoped RLS backstop, diff audit,
 * campaign template provenance). This file adds: admin gate, MFA, rate limit,
 * search, and batching.
 */

import { getAdminContext } from "./actions";
import { requireMfaForMutation } from "./mfa";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { ENTITIES, applyEntityEdit, isValidEntityId, type EntityType } from "./entity-edit";

export type MasterEditRow = Record<string, unknown>;
export type MasterSearchResult = { ok: true; rows: MasterEditRow[] } | { ok: false; error: string };

const MAX_ROWS = 50;
const MAX_BATCH = 50;

// PostgREST .or() treats , ( ) as syntax — strip them from search input.
const cleanQuery = (q: unknown) => String(q ?? "").replace(/[,()]/g, " ").trim().slice(0, 80);

/** Search rows of one entity type for the edit grid. User-scoped client (RLS). */
export async function searchEntitiesForEdit(
  type: string,
  query: string,
  state?: string,
): Promise<MasterSearchResult> {
  const ctx = await getAdminContext({ require: "use_master_edit" });
  if (!ctx.ok) return { ok: false, error: "Admins only." };
  const def = ENTITIES[type as EntityType];
  if (!def) return { ok: false, error: "Unknown entity type." };
  if (!(await checkRateLimit(`master_edit_search:${ctx.userId}`, 120, 3600))) {
    return { ok: false, error: "Too many searches this hour." };
  }

  const supabase = await createClient();
  let sel = supabase.from(def.table).select(def.displayCols.join(",")).limit(MAX_ROWS);
  const q = cleanQuery(query);
  if (q.length >= 2) sel = sel.or(def.searchCols.map((c) => `${c}.ilike.%${q}%`).join(","));
  const st = String(state ?? "").toUpperCase();
  if (/^[A-Z]{2}$/.test(st)) {
    if (type === "alert") sel = sel.eq("locality", st);
    else if (type !== "state") sel = sel.eq("state", st);
  }
  sel = sel.order(def.searchCols[0], { ascending: true });

  const { data, error } = await sel;
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as unknown as MasterEditRow[] };
}

export type MasterEdit = { type: string; id: string; changes: Record<string, unknown> };
export type MasterApplyRow = { type: string; id: string; ok: boolean; message: string };
export type MasterApplyResult = { ok: true; results: MasterApplyRow[] } | { ok: false; error: string };

/** Apply a reviewed batch of whitelisted edits. Each row is validated, diffed,
 *  and audit-logged individually by applyEntityEdit. */
export async function applyMasterEdits(edits: MasterEdit[]): Promise<MasterApplyResult> {
  const ctx = await getAdminContext({ require: "use_master_edit" });
  if (!ctx.ok) return { ok: false, error: "Admins only." };
  const mfaErr = requireMfaForMutation(ctx);
  if (mfaErr) return { ok: false, error: mfaErr };
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: "Nothing to apply." };
  if (edits.length > MAX_BATCH) return { ok: false, error: `Max ${MAX_BATCH} rows per apply.` };
  if (!(await checkRateLimit(`master_edit_apply:${ctx.userId}`, 20, 3600))) {
    return { ok: false, error: "Too many apply batches this hour — slow down." };
  }

  // Cheap pre-validation so one bad row is reported without partial surprises;
  // the apply below still handles per-row failures independently.
  for (const e of edits) {
    if (!ENTITIES[e.type as EntityType] || !isValidEntityId(e.type as EntityType, String(e.id))) {
      return { ok: false, error: `Bad row: ${e.type} ${e.id}` };
    }
  }

  const supabase = await createClient();
  const results: MasterApplyRow[] = [];
  for (const e of edits) {
    const r = await applyEntityEdit(supabase, ctx.userId, {
      type: e.type,
      id: String(e.id),
      changes: e.changes ?? {},
    });
    results.push({ type: e.type, id: String(e.id), ok: r.ok, message: r.message });
  }
  return { ok: true, results };
}
