/**
 * Badge catalog. Each entry defines a mission-patch the user can earn.
 * Badge ids are stable strings stored in user_badges.badge_id; rename
 * with care (existing rows will dangle).
 *
 * Awarding flow: server-side code calls awardBadge(userId, badgeId).
 * The PRIMARY KEY (user_id, badge_id) means re-awarding is a silent
 * no-op — safe to call from idempotent triggers like "on action sent."
 */

export type BadgeId =
  | "first_email"
  | "first_call"
  | "five_emails"
  | "twenty_five_emails"
  | "hundred_emails"
  | "first_thread"
  | "first_reply"
  | "streak_7"
  | "streak_30"
  | "streak_100"
  | "bipartisan_outreach"
  | "early_adopter";

export type Badge = {
  id: BadgeId;
  name: string;
  emoji: string;
  description: string;
  /** rarity informs styling: common (zinc) / rare (emerald) / epic (amber) / legendary (red) */
  rarity: "common" | "rare" | "epic" | "legendary";
};

export const BADGES: Record<BadgeId, Badge> = {
  first_email: {
    id: "first_email",
    name: "First Email Sent",
    emoji: "📨",
    description: "Sent your first campaign email to a legislator.",
    rarity: "common",
  },
  first_call: {
    id: "first_call",
    name: "First Call Made",
    emoji: "📞",
    description: "Logged your first phone-call action.",
    rarity: "common",
  },
  five_emails: {
    id: "five_emails",
    name: "5 emails",
    emoji: "🥉",
    description: "Sent 5 campaign emails.",
    rarity: "common",
  },
  twenty_five_emails: {
    id: "twenty_five_emails",
    name: "25 emails",
    emoji: "🥈",
    description: "Sent 25 campaign emails. You're a regular.",
    rarity: "rare",
  },
  hundred_emails: {
    id: "hundred_emails",
    name: "100 emails",
    emoji: "🥇",
    description: "Sent 100+ campaign emails. Heavy hitter.",
    rarity: "epic",
  },
  first_thread: {
    id: "first_thread",
    name: "First Thread",
    emoji: "💬",
    description: "Started a forum thread.",
    rarity: "common",
  },
  first_reply: {
    id: "first_reply",
    name: "First Reply",
    emoji: "↩️",
    description: "Replied to a forum thread.",
    rarity: "common",
  },
  streak_7: {
    id: "streak_7",
    name: "Week-Long Streak",
    emoji: "🔥",
    description: "Took action 7 days in a row.",
    rarity: "rare",
  },
  streak_30: {
    id: "streak_30",
    name: "30-Day Streak",
    emoji: "🔥🔥",
    description: "Took action 30 days in a row.",
    rarity: "epic",
  },
  streak_100: {
    id: "streak_100",
    name: "100-Day Streak",
    emoji: "🔥🔥🔥",
    description: "100-day action streak. Legendary.",
    rarity: "legendary",
  },
  bipartisan_outreach: {
    id: "bipartisan_outreach",
    name: "Bipartisan Outreach",
    emoji: "🤝",
    description: "Emailed both R + D legislators on the same campaign.",
    rarity: "rare",
  },
  early_adopter: {
    id: "early_adopter",
    name: "Early Adopter",
    emoji: "🌱",
    description: "Joined iKratom in its first month.",
    rarity: "rare",
  },
};

export const ALL_BADGES = Object.values(BADGES);
