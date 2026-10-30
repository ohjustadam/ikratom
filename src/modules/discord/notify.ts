import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { recordAdminAction } from "@/lib/audit";
import { sendDiscordEmbed, EMBED_COLORS, type DiscordEmbed } from "@/lib/discord/webhook";

/**
 * Discord fan-out, called server-side from event sources (auto-create, bill
 * edits). Kept OUT of actions.ts on purpose (security sweep 2026-10-30):
 * every export of a "use server" file is a server action anyone can invoke,
 * and these post to every configured Discord server with no login check.
 */

export const VALID_EVENTS = [
  "bill_drop_hostile",
  "bill_drop_friendly",
  "bill_status_change",
  "campaign_launch",
  "wave_fire",
  "federal_action_moment",
  "weekly_digest",
] as const;
export type EventKind = (typeof VALID_EVENTS)[number];

export async function recordOnFailure(
  id: string,
  row: { consecutive_failures: number; total_failures: number },
  result: { gone: boolean; error: string; status: number },
) {
  const supabase = createServiceRoleClient();
  const nextFailures = row.consecutive_failures + 1;
  const updates: Record<string, unknown> = {
    consecutive_failures: nextFailures,
    total_failures: row.total_failures + 1,
  };
  // Auto-disable after 3 consecutive failures, or any 404/410 immediately.
  if (result.gone || nextFailures >= 3) {
    updates.active = false;
  }
  await supabase.from("discord_integrations").update(updates).eq("id", id);
  await recordAdminAction({
    action: "discord.send_failed",
    targetId: id,
    details: { status: result.status, error: result.error.slice(0, 300), gone: result.gone, auto_disabled: !!updates.active === false },
  });
}

// ============================================================
// Fan-out helpers — called server-side from event sources.
// All use the service-role client because they run in cron / system
// contexts where there's no logged-in user.
// ============================================================

export async function notifyDiscordOnBillDrop(input: {
  billId: string;
  state: string | null;
  title: string;
  sponsor: string | null;
  status: string | null;
  isHostile: boolean;
}) {
  const supabase = createServiceRoleClient();
  const eventKind: EventKind = input.isHostile ? "bill_drop_hostile" : "bill_drop_friendly";

  const { data: integrations } = await supabase
    .from("discord_integrations")
    .select("id, webhook_url, server_name, events_enabled, state_filter, total_posts, total_failures, consecutive_failures")
    .eq("active", true)
    .or(`state_filter.is.null,state_filter.eq.${input.state ?? "FED"}`);

  const candidates = (integrations ?? []).filter((r) =>
    Array.isArray(r.events_enabled) && r.events_enabled.includes(eventKind),
  );
  if (candidates.length === 0) return { sent: 0, failed: 0 };

  const embed: DiscordEmbed = {
    title: `${input.isHostile ? "🚨" : "✅"} New ${input.isHostile ? "anti" : "pro"}-kratom bill ${input.state ? `in ${input.state}` : "(federal)"}`,
    description: input.title.slice(0, 4_000),
    url: `https://www.ikratom.org/bills/${input.billId}`,
    color: input.isHostile ? EMBED_COLORS.red : EMBED_COLORS.emerald,
    fields: [
      ...(input.sponsor ? [{ name: "Sponsor", value: input.sponsor, inline: true }] : []),
      ...(input.status ? [{ name: "Status", value: input.status, inline: true }] : []),
    ],
    footer: { text: input.isHostile ? "Take 30s action via iKratom" : "Watch this one — could need support" },
    timestamp: new Date().toISOString(),
  };

  return await fanOut(candidates, embed);
}

export async function notifyDiscordOnBillStatusChange(input: {
  billId: string;
  state: string | null;
  billNumber: string;
  title: string;
  fromStatus: string | null;
  toStatus: string;
  isHostile: boolean;
}) {
  const supabase = createServiceRoleClient();
  const { data: integrations } = await supabase
    .from("discord_integrations")
    .select("id, webhook_url, server_name, events_enabled, state_filter, total_posts, total_failures, consecutive_failures")
    .eq("active", true)
    .or(`state_filter.is.null,state_filter.eq.${input.state ?? "FED"}`);

  const candidates = (integrations ?? []).filter((r) =>
    Array.isArray(r.events_enabled) && r.events_enabled.includes("bill_status_change"),
  );
  if (candidates.length === 0) return { sent: 0, failed: 0 };

  // Status-change wording — emoji signals direction (passed = bad if
  // hostile, good if friendly; dead = good if hostile, bad if friendly).
  const advancing = ["committee", "passed_chamber", "enacted"].includes(input.toStatus);
  const dying = input.toStatus === "dead";
  const directionEmoji = dying
    ? (input.isHostile ? "✅" : "💀")
    : advancing
      ? (input.isHostile ? "🚨" : "📈")
      : "📋";
  const headline = dying
    ? `${directionEmoji} ${input.state ?? "FED"} ${input.billNumber} → DEAD`
    : `${directionEmoji} ${input.state ?? "FED"} ${input.billNumber}: ${input.fromStatus ?? "?"} → ${input.toStatus}`;

  const embed: DiscordEmbed = {
    title: headline.slice(0, 256),
    description: input.title.slice(0, 4_000),
    url: `https://www.ikratom.org/bills/${input.billId}`,
    color: input.isHostile && advancing
      ? EMBED_COLORS.red
      : input.isHostile && dying
        ? EMBED_COLORS.emerald
        : !input.isHostile && advancing
          ? EMBED_COLORS.emerald
          : EMBED_COLORS.amber,
    fields: [
      { name: "Stance", value: input.isHostile ? "Anti-kratom" : "Pro/neutral", inline: true },
      ...(input.fromStatus ? [{ name: "From", value: input.fromStatus, inline: true }] : []),
      { name: "To", value: input.toStatus, inline: true },
    ],
    footer: { text: input.isHostile && advancing ? "Take action now — bill is moving" : "Status update via iKratom" },
    timestamp: new Date().toISOString(),
  };

  return await fanOut(candidates, embed);
}

export async function notifyDiscordOnCampaignLaunch(input: {
  campaignId: string;
  title: string;
  state: string | null;
  description: string | null;
}) {
  const supabase = createServiceRoleClient();
  const { data: integrations } = await supabase
    .from("discord_integrations")
    .select("id, webhook_url, server_name, events_enabled, state_filter, total_posts, total_failures, consecutive_failures")
    .eq("active", true)
    .or(`state_filter.is.null,state_filter.eq.${input.state ?? "FED"}`);

  const candidates = (integrations ?? []).filter((r) =>
    Array.isArray(r.events_enabled) && r.events_enabled.includes("campaign_launch"),
  );
  if (candidates.length === 0) return { sent: 0, failed: 0 };

  const embed: DiscordEmbed = {
    title: `📣 Campaign live${input.state ? ` — ${input.state}` : ""}`,
    description: input.title.slice(0, 4_000),
    url: `https://www.ikratom.org/campaigns/${input.campaignId}`,
    color: EMBED_COLORS.amber,
    fields: input.description ? [{ name: "Why", value: input.description.slice(0, 1_000) }] : undefined,
    footer: { text: "Take action — one click" },
    timestamp: new Date().toISOString(),
  };

  return await fanOut(candidates, embed);
}

async function fanOut(
  rows: Array<{
    id: string;
    webhook_url: string;
    server_name: string;
    total_posts: number;
    total_failures: number;
    consecutive_failures: number;
  }>,
  embed: DiscordEmbed,
) {
  const supabase = createServiceRoleClient();
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const r = await sendDiscordEmbed(row.webhook_url, embed);
    if (r.ok) {
      sent++;
      await supabase
        .from("discord_integrations")
        .update({
          last_post_at: new Date().toISOString(),
          consecutive_failures: 0,
          total_posts: row.total_posts + 1,
        })
        .eq("id", row.id);
    } else {
      failed++;
      await recordOnFailure(row.id, row, r);
    }
  }
  return { sent, failed };
}
