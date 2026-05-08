"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { normalizeLocality } from "@/lib/locality";

/**
 * User-driven local rep coverage requests.
 *
 * When a user has city/state on their profile but iKratom doesn't have
 * any local legislators in our DB for their area, the dashboard banner
 * lets them click "Request coverage." That hits requestCoverage() which
 * inserts a row into local_rep_requests. Admin sees the queue at
 * /admin/local-rep-requests.
 *
 * On the admin side, the existing /admin/locals/suggest flow remains
 * the AI-discovery surface. When the admin accepts suggestions for an
 * area, acceptSuggestions calls fulfill_local_rep_requests RPC + the
 * notification fan-out, closing the loop.
 */

export async function requestCoverage(input: {
  locality: string;
  state: string;
  level: "municipal" | "county";
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in." };

  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { error: "Invalid state." };
  if (!["municipal", "county"].includes(input.level)) return { error: "Invalid level." };

  const localityNorm = normalizeLocality(input.locality, stateRaw) ?? "";
  if (!localityNorm) return { error: "Invalid locality." };

  // Idempotent — UNIQUE constraint on (user, state, locality, level)
  // means duplicate clicks don't pile up.
  const { error } = await supabase
    .from("local_rep_requests")
    .upsert(
      {
        user_id: user.id,
        state: stateRaw,
        locality: localityNorm,
        level: input.level,
        status: "pending",
      },
      { onConflict: "user_id,state,locality,level" },
    );
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Has the current user requested coverage for the given (state, locality, level)?
 * Used by the dashboard banner to swap "Request coverage" → "Requested ✓".
 */
export async function hasUserRequestedCoverage(input: {
  locality: string;
  state: string;
  level: "municipal" | "county";
}): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return false;
  const localityNorm = normalizeLocality(input.locality, stateRaw) ?? "";
  if (!localityNorm) return false;

  const { data } = await supabase
    .from("local_rep_requests")
    .select("id")
    .eq("user_id", user.id)
    .eq("state", stateRaw)
    .eq("locality", localityNorm)
    .eq("level", input.level)
    .eq("status", "pending")
    .limit(1);

  return !!(data && data.length > 0);
}

// ============================================================
// Admin queue
// ============================================================

export async function listPendingCoverageRequests() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const supabase = await createClient();
  // Aggregate: group by (state, locality, level) — admins care about
  // areas with demand, not individual user rows. Count is shown so they
  // can prioritize areas with multiple pending users.
  const { data, error } = await supabase
    .from("local_rep_requests")
    .select("state, locality, level, user_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };

  type Row = { state: string; locality: string; level: string; user_id: string };
  const grouped = new Map<string, { state: string; locality: string; level: string; user_count: number; user_ids: string[] }>();
  for (const r of (data ?? []) as Row[]) {
    const key = `${r.state}::${r.locality}::${r.level}`;
    if (!grouped.has(key)) {
      grouped.set(key, { state: r.state, locality: r.locality, level: r.level, user_count: 0, user_ids: [] });
    }
    const g = grouped.get(key)!;
    g.user_count++;
    g.user_ids.push(r.user_id);
  }
  return {
    ok: true,
    rows: Array.from(grouped.values()).sort((a, b) => b.user_count - a.user_count),
  };
}

export async function rejectCoverageRequest(input: {
  state: string;
  locality: string;
  level: "municipal" | "county";
  reason?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const stateRaw = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(stateRaw)) return { error: "Invalid state." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("local_rep_requests")
    .update({
      status: "rejected",
      resolved_at: new Date().toISOString(),
      resolved_by: ctx.userId,
      reject_reason: input.reason?.slice(0, 200) ?? null,
    })
    .eq("state", stateRaw)
    .eq("locality", input.locality)
    .eq("level", input.level)
    .eq("status", "pending");

  if (error) return { error: error.message };
  await recordAdminAction({
    action: "local_rep_request.reject",
    details: { state: stateRaw, locality: input.locality, level: input.level, reason: input.reason },
  });
  revalidatePath("/admin/local-rep-requests");
  return { ok: true };
}
