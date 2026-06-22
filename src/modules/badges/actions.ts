"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * Badge READ-side server actions (auth-scoped). The write-side helpers
 * (awardBadge / recomputeBadgesForUser) deliberately live in ./award.ts as
 * plain functions — NOT server actions — because they run with the
 * service-role client and write for an arbitrary user id, which must never be
 * a client-invocable endpoint. Trusted server callers / cron import them from
 * ./award directly.
 */

export async function listMyBadges() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("user_badges")
    .select("badge_id, earned_at, metadata")
    .eq("user_id", user.id)
    .order("earned_at", { ascending: false });
  return ((data ?? []) as { badge_id: string; earned_at: string; metadata: unknown }[]);
}

export async function listBadgesForUser(userId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_badges")
    .select("badge_id, earned_at")
    .eq("user_id", userId)
    .order("earned_at", { ascending: false });
  return ((data ?? []) as { badge_id: string; earned_at: string }[]);
}
