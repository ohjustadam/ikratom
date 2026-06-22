"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { normalizeLocality } from "@/lib/locality";
import { checkRateLimit } from "@/lib/rate-limit";

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

  // Notify admins so they don't miss the queue. Best-effort; never
  // blocks the user-facing response. Realtime publication on
  // notifications means each admin's bell-icon updates within seconds,
  // and the next push fan-out cron run delivers it as a system push
  // notification to admins who've enabled push.
  try {
    const sr = createServiceRoleClient();
    const { data: admins } = await sr
      .from("profiles")
      .select("id")
      .or("is_admin.eq.true,is_owner.eq.true");
    const adminIds = (admins ?? []).map((a: { id: string }) => a.id);
    if (adminIds.length > 0) {
      // Skip duplicate "you have N requests" alerts for the SAME area
      // by checking if an unread admin notification already exists for
      // this kind+locality. If so, we noop — the admin already knows
      // the area is in the queue. They'll see the count climb on
      // /admin/local-rep-requests, no need to re-ping.
      const { data: existingAlerts } = await sr
        .from("notifications")
        .select("id")
        .in("user_id", adminIds)
        .eq("kind", "local_rep_request")
        .eq("link", `/admin/local-rep-requests`)
        .is("read_at", null)
        .like("body", `%${localityNorm}%`)
        .limit(1);
      if (!existingAlerts || existingAlerts.length === 0) {
        await sr.from("notifications").insert(
          adminIds.map((uid) => ({
            user_id: uid,
            kind: "local_rep_request",
            title: "New local rep request",
            body: `A user requested coverage for ${localityNorm}. Click to review.`,
            link: "/admin/local-rep-requests",
          })),
        );
      }
    }
  } catch {
    // non-fatal
  }

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

/**
 * Kick the cloud resolution workflow on demand
 * (.github/workflows/cron-localreps-cloud.yml). The scheduled run drains the
 * pending queue every 6h via an in-job SearXNG container + headless Chromium +
 * free-tier extract; this lets an admin run it NOW instead of waiting — the
 * missing manual lever that made the live "AI suggest" button feel dead for
 * non-Legistar localities (it can't reach the box; this reaches the cloud).
 *
 * Auth: admin-gated + rate-limited. Token: a fine-grained GitHub PAT
 * (GITHUB_DISPATCH_TOKEN — Actions: read+write, this repo ONLY) stored
 * server-side in Vercel env. Never NEXT_PUBLIC; never returned to the client.
 */
export async function triggerCloudResolution(): Promise<
  { ok: true; runsUrl: string } | { error: string }
> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_DISPATCH_REPO || "ohjustadam/ikratom";
  if (!token) {
    return { error: "Cloud resolution isn't wired up yet — set GITHUB_DISPATCH_TOKEN (fine-grained PAT, Actions: read+write) in the server env." };
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: "GITHUB_DISPATCH_REPO is malformed." };

  // A run takes minutes; stacking more is pointless and just churns Actions.
  // 3 kicks / 10 min per admin.
  const allowed = await checkRateLimit(`cloud-resolve:${ctx.userId}`, 3, 600);
  if (!allowed) {
    return { error: "Already kicked it a few times — give the current run a couple minutes to finish." };
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/cron-localreps-cloud.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "iKratom-admin",
        },
        body: JSON.stringify({ ref: "main", inputs: { limit: "40" } }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return { error: `Couldn't reach GitHub: ${(e as Error).message}` };
  }

  if (res.status === 204) {
    try {
      await recordAdminAction({ action: "local_reps.cloud_resolve_dispatch", details: { repo } });
    } catch { /* non-fatal */ }
    return { ok: true, runsUrl: `https://github.com/${repo}/actions/workflows/cron-localreps-cloud.yml` };
  }
  if (res.status === 401 || res.status === 403) {
    return { error: "GitHub rejected the token — check GITHUB_DISPATCH_TOKEN has Actions: read+write on this repo." };
  }
  if (res.status === 404) {
    return { error: "Workflow not found — it must exist on the default branch (main)." };
  }
  const body = await res.text().catch(() => "");
  return { error: `GitHub dispatch failed (${res.status}). ${body.slice(0, 120)}` };
}
