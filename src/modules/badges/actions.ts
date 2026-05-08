"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BADGES, type BadgeId } from "./catalog";

/**
 * Badge-awarding helpers. Two paths:
 *   - awardBadge(userId, badgeId) — used by server actions / cron when
 *     a condition has been met. Idempotent (PK on user_id+badge_id).
 *   - listMyBadges() — read-side for the dashboard widget + profile.
 *
 * Called from action-related server actions like sendCampaignEmail to
 * progressively award the email-count tiers.
 */

export async function awardBadge(userId: string, badgeId: BadgeId, metadata?: Record<string, unknown>) {
  if (!BADGES[badgeId]) return { error: "Unknown badge id." };
  const sr = createServiceRoleClient();
  const { error } = await sr
    .from("user_badges")
    .insert({ user_id: userId, badge_id: badgeId, metadata: metadata ?? null })
    .select("badge_id");
  // Ignore unique-violation (already earned)
  if (error && error.code !== "23505") return { error: error.message };

  // Fire an in-app notification when newly awarded — celebrates the moment.
  if (!error) {
    const badge = BADGES[badgeId];
    await sr.from("notifications").insert({
      user_id: userId,
      kind: "badge_earned",
      title: `You earned: ${badge.emoji} ${badge.name}`,
      body: badge.description,
      link: "/account/badges",
    });
  }
  return { ok: true, newly_awarded: !error };
}

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

/**
 * Recompute badges for a single user from current state. Used as the
 * batch entrypoint — called from cron after streaks update + occasionally
 * for backfill. Awards are idempotent so re-running is safe.
 */
export async function recomputeBadgesForUser(userId: string) {
  const sr = createServiceRoleClient();

  // Pull what we need to evaluate every condition in one pass
  const [{ data: profile }, { data: actions }, { count: threadCount }, { count: replyCount }] = await Promise.all([
    sr.from("profiles").select("created_at, action_streak_days, longest_streak_days").eq("id", userId).single(),
    sr.from("campaign_actions").select("id, method, campaign_id, sent_at").eq("user_id", userId),
    sr.from("forum_threads").select("id", { count: "exact", head: true }).eq("author_id", userId),
    sr.from("forum_posts").select("id", { count: "exact", head: true }).eq("author_id", userId),
  ]);

  const totalActions = (actions ?? []).length;
  const calls = (actions ?? []).filter((a: { method: string | null }) => a.method === "call").length;
  const emails = totalActions - calls;
  const streakBest = (profile as { longest_streak_days?: number } | null)?.longest_streak_days ?? 0;

  const awards: BadgeId[] = [];
  if (emails >= 1) awards.push("first_email");
  if (calls >= 1) awards.push("first_call");
  if (emails >= 5) awards.push("five_emails");
  if (emails >= 25) awards.push("twenty_five_emails");
  if (emails >= 100) awards.push("hundred_emails");
  if ((threadCount ?? 0) >= 1) awards.push("first_thread");
  if ((replyCount ?? 0) >= 1) awards.push("first_reply");
  if (streakBest >= 7) awards.push("streak_7");
  if (streakBest >= 30) awards.push("streak_30");
  if (streakBest >= 100) awards.push("streak_100");
  // early_adopter: profile.created_at within 30d of platform launch (placeholder = 2026-04-01)
  if (profile?.created_at && new Date(profile.created_at) < new Date("2026-05-01T00:00:00Z")) {
    awards.push("early_adopter");
  }

  for (const id of awards) {
    await awardBadge(userId, id);
  }
  return { evaluated: awards.length };
}
