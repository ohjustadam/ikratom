"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAdminContext } from "@/modules/admin/actions";
import { recordAdminAction } from "@/lib/audit";
import { sendDiscordEmbed, maskWebhook, EMBED_COLORS, type DiscordEmbed } from "@/lib/discord/webhook";

/**
 * Discord integration CRUD + fan-out helpers.
 *
 * Public surface (admin-only):
 *   - createDiscordIntegration       — register a new server's webhook
 *   - updateDiscordIntegration        — change events_enabled / state_filter / active
 *   - deleteDiscordIntegration        — remove
 *   - testDiscordIntegration          — sends a "✓ test post" so admin confirms wiring
 *   - listDiscordIntegrations         — for the admin page
 *
 * Fan-out (server-side, called from cron / event hooks, not user-facing):
 *   - notifyDiscordOnBillDrop, notifyDiscordOnCampaignLaunch, etc.
 */

const SLUG_RE = /^[a-z0-9-]{1,80}$/;
const STATE_RE = /^[A-Z]{2}$/;
const VALID_EVENTS = [
  "bill_drop_hostile",
  "bill_drop_friendly",
  "campaign_launch",
  "wave_fire",
  "federal_action_moment",
  "weekly_digest",
] as const;
type EventKind = (typeof VALID_EVENTS)[number];

export type DiscordIntegration = {
  id: string;
  webhook_url: string;
  server_name: string;
  server_slug: string;
  channel_name: string | null;
  events_enabled: EventKind[];
  state_filter: string | null;
  active: boolean;
  consecutive_failures: number;
  total_posts: number;
  total_failures: number;
  last_post_at: string | null;
  created_at: string;
};

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

async function uniqueSlug(supabase: Awaited<ReturnType<typeof createClient>>, base: string): Promise<string> {
  const cleanBase = base || "server";
  let candidate = cleanBase;
  let n = 2;
  while (n < 50) {
    const { data } = await supabase
      .from("discord_integrations")
      .select("id")
      .eq("server_slug", candidate)
      .limit(1);
    if (!data || data.length === 0) return candidate;
    candidate = `${cleanBase}-${n}`.slice(0, 80);
    n++;
  }
  return `${cleanBase}-${Date.now()}`.slice(0, 80);
}

export async function createDiscordIntegration(input: {
  webhookUrl: string;
  serverName: string;
  channelName?: string;
  events?: string[];
  stateFilter?: string;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };

  const webhookUrl = (input.webhookUrl ?? "").trim();
  // Basic shape check before insert (the DB CHECK enforces fully)
  if (!/^https:\/\/(?:discord(?:app)?\.com|canary\.discord(?:app)?\.com|ptb\.discord(?:app)?\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(webhookUrl)) {
    return { error: "That doesn't look like a Discord webhook URL." };
  }

  const serverName = (input.serverName ?? "").trim();
  if (serverName.length < 1 || serverName.length > 120) {
    return { error: "Server name must be 1–120 characters." };
  }

  const stateFilter = input.stateFilter?.trim().toUpperCase() || null;
  if (stateFilter && !STATE_RE.test(stateFilter)) {
    return { error: "State filter must be a 2-letter code." };
  }

  // Validate event list
  const events = (input.events ?? []).filter((e): e is EventKind =>
    (VALID_EVENTS as readonly string[]).includes(e),
  );
  const eventsToStore = events.length > 0 ? events : ["bill_drop_hostile", "campaign_launch"];

  const supabase = await createClient();
  const slug = await uniqueSlug(supabase, slugify(serverName));

  const { data, error } = await supabase
    .from("discord_integrations")
    .insert({
      webhook_url: webhookUrl,
      server_name: serverName,
      server_slug: slug,
      channel_name: input.channelName?.trim() || null,
      events_enabled: eventsToStore,
      state_filter: stateFilter,
      added_by_user_id: ctx.userId,
    })
    .select("*")
    .single();
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "discord.create",
    targetId: data.id,
    details: { server_name: serverName, server_slug: slug, masked_webhook: maskWebhook(webhookUrl) },
  });
  revalidatePath("/admin/discord-integrations");
  return { ok: true, integration: data as DiscordIntegration };
}

export async function listDiscordIntegrations() {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discord_integrations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { error: error.message };
  return { ok: true, rows: (data ?? []) as DiscordIntegration[] };
}

export async function getDiscordIntegration(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("discord_integrations").select("*").eq("id", id).single();
  if (error) return { error: error.message };
  return { ok: true, integration: data as DiscordIntegration };
}

export async function updateDiscordIntegration(input: {
  id: string;
  serverName?: string;
  channelName?: string;
  events?: string[];
  stateFilter?: string;
  active?: boolean;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { error: "Invalid id." };

  const update: Record<string, unknown> = {};
  if (input.serverName !== undefined) {
    const v = input.serverName.trim();
    if (v.length < 1 || v.length > 120) return { error: "Server name 1–120 chars." };
    update.server_name = v;
  }
  if (input.channelName !== undefined) update.channel_name = input.channelName.trim() || null;
  if (input.events !== undefined) {
    const events = input.events.filter((e): e is EventKind =>
      (VALID_EVENTS as readonly string[]).includes(e),
    );
    update.events_enabled = events;
  }
  if (input.stateFilter !== undefined) {
    const v = input.stateFilter.trim().toUpperCase();
    if (v && !STATE_RE.test(v)) return { error: "State filter must be 2-letter code." };
    update.state_filter = v || null;
  }
  if (input.active !== undefined) {
    update.active = input.active;
    if (input.active) update.consecutive_failures = 0; // reset on re-enable
  }

  const supabase = await createClient();
  const { error } = await supabase.from("discord_integrations").update(update).eq("id", input.id);
  if (error) return { error: error.message };

  await recordAdminAction({
    action: "discord.update",
    targetId: input.id,
    details: { fields_changed: Object.keys(update) },
  });
  revalidatePath("/admin/discord-integrations");
  return { ok: true };
}

export async function deleteDiscordIntegration(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };
  const supabase = await createClient();
  const { error } = await supabase.from("discord_integrations").delete().eq("id", id);
  if (error) return { error: error.message };
  await recordAdminAction({ action: "discord.delete", targetId: id });
  revalidatePath("/admin/discord-integrations");
  return { ok: true };
}

export async function testDiscordIntegration(id: string) {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { error: "Admins only." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Invalid id." };

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("discord_integrations")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !row) return { error: error?.message ?? "Not found." };

  const result = await sendDiscordEmbed(row.webhook_url, {
    title: "✅ iKratom test post",
    description:
      "This is a test from iKratom admin. If you see this, your webhook is wired up correctly. Real bill alerts will look similar.",
    color: EMBED_COLORS.emerald,
    footer: { text: `Integration: ${row.server_name}` },
    timestamp: new Date().toISOString(),
  });

  if (result.ok) {
    await supabase
      .from("discord_integrations")
      .update({ last_post_at: new Date().toISOString(), consecutive_failures: 0, total_posts: row.total_posts + 1 })
      .eq("id", id);
    await recordAdminAction({ action: "discord.test_ok", targetId: id });
    return { ok: true };
  }

  await recordOnFailure(id, row, result);
  return { error: `Discord said ${result.status}: ${result.error}` };
}

async function recordOnFailure(
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
