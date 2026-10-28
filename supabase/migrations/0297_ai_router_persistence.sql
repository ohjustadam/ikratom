-- 0297_ai_router_persistence.sql
--
-- Gives the free AI router (scripts/lib/ai-router.mjs) a memory that outlives one
-- process (owner, 2026-10-27: "make the engine sturdier").
--
--  ai_provider_health: when a provider is throttled or gone, the deadline is
--    stored here. Every cron run and every website request used to rediscover a
--    dead provider by failing on it (one run logged `github 0/49`). Now the first
--    process to hit the failure records it, and the rest skip it until it expires.
--  ai_response_cache: an opt-in cache for prompts that repeat (callers pass
--    cacheTtlHours). Rows carry their own expiry, and the router purges expired
--    rows as it writes, so the table stays small (the 0.5 GB cap never resets).
--
-- Service role only: RLS is on with no policies, and anon/authenticated get no
-- grants. Explicit GRANTs, as required for new public tables from 2026-10-30.
--
-- Rollback:
--   drop table if exists public.ai_response_cache;
--   drop table if exists public.ai_provider_health;

create table if not exists public.ai_provider_health (
  provider       text primary key,
  cooldown_until timestamptz not null,
  reason         text,
  updated_at     timestamptz not null default now()
);

create table if not exists public.ai_response_cache (
  key        text primary key,          -- sha256 of model tier + prompts + max tokens
  provider   text not null,
  response   jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_response_cache_expires_idx on public.ai_response_cache (expires_at);

alter table public.ai_provider_health enable row level security;
alter table public.ai_response_cache enable row level security;

revoke all on public.ai_provider_health from anon, authenticated;
revoke all on public.ai_response_cache from anon, authenticated;
grant select, insert, update, delete on public.ai_provider_health to service_role;
grant select, insert, update, delete on public.ai_response_cache to service_role;
