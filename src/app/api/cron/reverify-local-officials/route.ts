import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reVerifyLocality, autoFulfillLocality } from "@/lib/local-reps-auto-fulfill";
import { getGroundingBudget } from "@/lib/ai/grounding-budget";
import { isRetryableGroundingError } from "@/lib/ai/grounding-errors";

/**
 * Periodic re-verification of locally-elected officials.
 *
 * Owner directive 2026-05-16: "put in a failsafe way now to auto update
 * and recognize the officials so we ensure we dont list someone that is
 * no longer an official because we havent updated it with the new
 * officials."
 *
 * Two passes per run:
 *
 *   1. **Term-expired sweep** — every active municipal/county legislator
 *      with `term_end_date < NOW()` is re-verified. If they're still in
 *      the source page → just update last_synced_at + carry on. If
 *      they're no longer cited → mark active=false. Then auto-fulfill
 *      the locality to pull in their replacement(s).
 *
 *   2. **Stale sweep** — every locality whose officials haven't been
 *      re-checked in 90+ days gets a re-verify pass. Catches
 *      resignations, recalls, and lost re-elections that don't have a
 *      known term_end_date.
 *
 * Also processes any pending `local_rep_requests` rows that were
 * queued by the auto-request flow but never resolved (e.g. because
 * the first auto-fulfill pass failed verification — admin can retry
 * via this same cron until source pages stabilize).
 *
 * Triggered via Vercel cron (vercel.json) at a low-volume hour, OR
 * manually via gh workflow run. Verified by CRON_SECRET header.
 *
 * Gemini quota: ~500 grounded queries/project/day on free tier. The
 * caps here (5 + 5 + 5 = 15 max grounded calls per day) keep this
 * cron well under the budget; the budget guard in suggest-officials.ts
 * + officials-slate.mjs is the hard backstop. Cron now runs DAILY
 * instead of weekly to spread load — same total weekly throughput, no
 * Sunday spike that used to blow the quota (V2_KICKOFF §3.A1).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — plenty for ~15 localities at ~5s each

const REVERIFY_AGE_DAYS = 90;
const MAX_TERM_EXPIRED_PER_RUN = 5; // daily, was 15 weekly
const MAX_STALE_PER_RUN = 5;         // daily, was 15 weekly
const MAX_PENDING_PER_RUN = 5;       // daily, was 20 weekly

export async function GET(request: NextRequest) {
  // Defense-in-depth: refuse to run if the secret is unset in env.
  // Otherwise an empty-string CRON_SECRET would make the header check
  // pass on `Bearer ` (literal space-then-empty) — narrow window but
  // worth eliminating.
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return NextResponse.json({ error: "cron secret not configured" }, { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const stats = {
    termExpiredRetired: 0,
    staleLocalitiesReVerified: 0,
    pendingFulfilled: 0,
    pendingFailed: 0,
    errors: [] as string[],
    /** Snapshot of today's grounded-query budget at the start of the
     *  run. If `exhausted` is true we bail before any Gemini calls so
     *  the cron doesn't compound an already-blown quota. */
    quota: null as null | { usedToday: number; cap: number; remaining: number; exhausted: boolean },
  };

  // Budget check up front. If today's cap is already gone (e.g. an
  // admin clicked AI suggest 400+ times, or the daily scripts already
  // ran), this cron skips cleanly rather than logging 15 more failures.
  stats.quota = await getGroundingBudget(admin);
  if (stats.quota.exhausted) {
    return NextResponse.json({
      ok: true,
      ranAt: new Date().toISOString(),
      skipped: "grounded-quota-exhausted",
      stats,
    });
  }

  // ── Pass 1: term-expired officials ─────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const { data: expired } = await admin
    .from("legislators")
    .select("locality, state, level")
    .eq("active", true)
    .in("level", ["municipal", "county"])
    .lt("term_end_date", today);
  // De-dupe to locality+level pairs
  const expiredPairs = new Map<string, { locality: string; state: string; level: "municipal" | "county" }>();
  for (const row of (expired ?? []) as Array<{ locality: string; state: string; level: "municipal" | "county" }>) {
    if (!row.locality || !row.state) continue;
    expiredPairs.set(`${row.state}|${row.locality}|${row.level}`, row);
  }

  for (const [, pair] of [...expiredPairs.entries()].slice(0, MAX_TERM_EXPIRED_PER_RUN)) {
    try {
      const r = await reVerifyLocality(pair);
      stats.termExpiredRetired += r.retired.length;
      if (r.error) {
        stats.errors.push(`term-expired ${pair.locality}: ${r.error}`);
        // Stop the pass early if the upstream error is quota — every
        // subsequent call will fail the same way and uselessly fill
        // ai_jobs with quota_exhausted rows.
        if (isRetryableGroundingError(r.error)) break;
      }
    } catch (e) {
      stats.errors.push(`term-expired ${pair.locality}: ${(e as Error).message}`);
    }
  }

  // ── Pass 2: localities not synced in N days ───────────────────────
  const ninetyDaysAgo = new Date(Date.now() - REVERIFY_AGE_DAYS * 86400_000).toISOString();
  const { data: stale } = await admin
    .from("legislators")
    .select("locality, state, level, last_synced_at")
    .eq("active", true)
    .in("level", ["municipal", "county"])
    .lt("last_synced_at", ninetyDaysAgo);
  const stalePairs = new Map<string, { locality: string; state: string; level: "municipal" | "county" }>();
  for (const row of (stale ?? []) as Array<{ locality: string; state: string; level: "municipal" | "county" }>) {
    if (!row.locality || !row.state) continue;
    stalePairs.set(`${row.state}|${row.locality}|${row.level}`, { locality: row.locality, state: row.state, level: row.level });
  }
  for (const [, pair] of [...stalePairs.entries()].slice(0, MAX_STALE_PER_RUN)) {
    try {
      const r = await reVerifyLocality(pair);
      stats.staleLocalitiesReVerified++;
      if (r.error && isRetryableGroundingError(r.error)) {
        stats.errors.push(`stale ${pair.locality}: ${r.error}`);
        break;
      }
    } catch (e) {
      stats.errors.push(`stale ${pair.locality}: ${(e as Error).message}`);
    }
  }

  // ── Pass 3: pending local_rep_requests (retry failed auto-fulfills) ──
  const { data: pending } = await admin
    .from("local_rep_requests")
    .select("state, locality, level")
    .eq("status", "pending")
    .limit(MAX_PENDING_PER_RUN * 4); // overshoot so dedupe still yields a full batch
  const pendingPairs = new Map<string, { locality: string; state: string; level: "municipal" | "county" }>();
  for (const row of (pending ?? []) as Array<{ locality: string; state: string; level: "municipal" | "county" }>) {
    pendingPairs.set(`${row.state}|${row.locality}|${row.level}`, row);
  }
  let pendingProcessed = 0;
  for (const [, pair] of pendingPairs) {
    if (pendingProcessed >= MAX_PENDING_PER_RUN) break;
    pendingProcessed++;
    try {
      const r = await autoFulfillLocality(pair);
      if (r.inserted > 0) stats.pendingFulfilled++;
      else stats.pendingFailed++;
      if (r.error && isRetryableGroundingError(r.error)) {
        stats.errors.push(`pending ${pair.locality}: ${r.error}`);
        break;
      }
    } catch (e) {
      stats.errors.push(`pending ${pair.locality}: ${(e as Error).message}`);
    }
  }

  // Refresh quota snapshot so the response shows post-run state.
  stats.quota = await getGroundingBudget(admin);

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    stats,
  });
}
