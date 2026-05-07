-- ============================================================
-- 0047_discord_integrations
--
-- Discord webhook outbound integration. Each row is one (server, channel,
-- event-set) tuple — a partner Discord server admin pastes a webhook URL
-- into /admin/discord-integrations and we post bill alerts, campaign
-- launches, and wave fires to that channel.
--
-- The webhook URL is a shared secret. Anyone with it can post into the
-- channel. We treat it like an API key: never log in plaintext, mask in
-- UI (show last 4 chars only), audit-log all access.
--
-- Attribution lives in the existing referrals/proxy.ts cookie capture —
-- partners can also have a slug here that's reused for ?ref=discord&host=
-- recruitment links (Phase 3).
--
-- See docs/DISCORD_INTEGRATION.md for design + docs/DISCORD_SERVER_SETUP.md
-- for the server admin's own checklist.
-- ============================================================

create table if not exists public.discord_integrations (
  id uuid primary key default gen_random_uuid(),

  -- The Discord webhook URL — secret. Format:
  -- https://discord.com/api/webhooks/<id>/<token>
  -- Length cap is generous to allow for any path Discord uses.
  webhook_url text not null check (
    webhook_url ~ '^https://(?:discord(?:app)?\.com|canary\.discord(?:app)?\.com|ptb\.discord(?:app)?\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'
  ),

  -- Display info — what the admin will recognize when looking at the list
  server_name text not null check (length(server_name) between 1 and 120),
  -- URL slug for ?ref=discord&host=<slug> attribution; matches the partner
  -- slug regex so the existing partner stats page can render this server's stats too.
  server_slug text not null unique check (server_slug ~ '^[a-z0-9-]{1,80}$'),
  channel_name text check (channel_name is null or length(channel_name) <= 100),

  added_by_user_id uuid references public.profiles(id) on delete set null,

  -- Which event types this integration receives. Stored as a JSONB array
  -- so we can grow the event set without migrations.
  --   bill_drop_hostile, bill_drop_friendly, campaign_launch, wave_fire,
  --   federal_action_moment, weekly_digest
  events_enabled jsonb not null default '["bill_drop_hostile","campaign_launch"]'::jsonb,

  -- Optional state filter — null = all states. Use for state-specific
  -- channels (e.g. an OK-only kratom server only wants OK bills).
  state_filter text check (state_filter is null or state_filter ~ '^[A-Z]{2}$'),

  active boolean not null default true,
  -- Auto-disabled after consecutive 404/410 responses (channel deleted /
  -- webhook revoked). UI surfaces a "needs reattention" badge.
  consecutive_failures int not null default 0,

  created_at timestamptz not null default now(),
  last_post_at timestamptz,
  total_posts int not null default 0,
  total_failures int not null default 0
);

create index if not exists idx_discord_integrations_active
  on public.discord_integrations (active, state_filter)
  where active = true;

alter table public.discord_integrations enable row level security;

-- Admin-only direct access. Webhook URL never exposed to non-admins.
drop policy if exists "discord_integrations_admin_all" on public.discord_integrations;
create policy "discord_integrations_admin_all"
  on public.discord_integrations
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Public-safe view for /partners/[slug] integration with attribution stats.
-- Excludes webhook_url + audit columns.
create or replace view public.discord_integrations_public as
  select id, server_name, server_slug, channel_name, state_filter, total_posts, last_post_at, created_at
    from public.discord_integrations
   where active = true;

grant select on public.discord_integrations_public to anon, authenticated;
