import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { reVerifyLocality, autoFulfillLocality } from "@/lib/local-reps-auto-fulfill";

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
 * Gemini quota: 1M tokens/day on free tier; a typical locality uses
 * ~5–10K tokens. The 90-day cadence keeps us well under quota even
 * with hundreds of localities.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — plenty for ~30 localities at ~5s each

const REVERIFY_AGE_DAYS = 90;
const MAX_LOCALITIES_PER_RUN = 30; // soft cap to stay under Gemini quota

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
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
  };

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

  for (const [, pair] of [...expiredPairs.entries()].slice(0, MAX_LOCALITIES_PER_RUN / 2)) {
    try {
      const r = await reVerifyLocality(pair);
      stats.termExpiredRetired += r.retired.length;
      if (r.error) stats.errors.push(`term-expired ${pair.locality}: ${r.error}`);
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
  const staleBudget = MAX_LOCALITIES_PER_RUN - expiredPairs.size;
  for (const [, pair] of [...stalePairs.entries()].slice(0, staleBudget)) {
    try {
      await reVerifyLocality(pair);
      stats.staleLocalitiesReVerified++;
    } catch (e) {
      stats.errors.push(`stale ${pair.locality}: ${(e as Error).message}`);
    }
  }

  // ── Pass 3: pending local_rep_requests (retry failed auto-fulfills) ──
  const { data: pending } = await admin
    .from("local_rep_requests")
    .select("state, locality, level")
    .eq("status", "pending")
    .limit(20);
  const pendingPairs = new Map<string, { locality: string; state: string; level: "municipal" | "county" }>();
  for (const row of (pending ?? []) as Array<{ locality: string; state: string; level: "municipal" | "county" }>) {
    pendingPairs.set(`${row.state}|${row.locality}|${row.level}`, row);
  }
  for (const [, pair] of pendingPairs) {
    try {
      const r = await autoFulfillLocality(pair);
      if (r.inserted > 0) stats.pendingFulfilled++;
      else stats.pendingFailed++;
    } catch (e) {
      stats.errors.push(`pending ${pair.locality}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    stats,
  });
}
