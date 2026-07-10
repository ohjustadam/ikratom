-- ============================================================
-- 0236 — Achievement points (Academy P1)
-- ============================================================
-- Owner ask: users earn achievement points for real advocacy. Foundation for
-- the iKratom Academy (private/ACHIEVEMENTS_AND_ACADEMY_PLAN.md). The public
-- "power-user checkmark" is deliberately NOT awarded here — it is course-gated
-- (P3) so it can't be farmed with points, per the owner's anti-cheese intent.
--
-- Points are awarded by a TRIGGER on campaign_actions (not a client-callable
-- award RPC — so no minting via an RPC with fabricated refs). Points/kind are
-- fixed in the trigger and awards are idempotent on
-- UNIQUE(user_id, kind, ref_id) NULLS NOT DISTINCT + ON CONFLICT DO NOTHING:
-- ref = the campaign id (first email/call on a campaign scores; re-sends and
-- the per-legislator fan-out rows don't) or, for direct compose sends, the
-- contacted official id. A ref-less send (ad-hoc stakeholder, legislator_id
-- null) scores nothing. So a user's LIFETIME points are capped at roughly
-- one-email + one-call per real campaign + one per contacted official.
--
-- HONEST TRUST NOTE (audit 2026-07-10): campaign_actions permits authenticated
-- self-inserts (actions_self_insert, 0001) — the same rows behind the cosmetic
-- email/call scoreboard — so a determined user CAN pad rows via direct
-- PostgREST up to that idempotency ceiling. That's acceptable for P1 because
-- points here are a COSMETIC personal scoreboard; the meaningful reward (the
-- public power-user checkmark) is COURSE-gated (P3), NOT points-based, so
-- padding grants no real privilege. The BEFORE-INSERT guard below re-arms the
-- 0218 daily cap (which keys off sent_at) against backdating, bounding the pad
-- rate. **Prerequisite before points ever gate a leaderboard or reward:** route
-- campaign_actions writes through SECURITY DEFINER RPCs that re-validate scope
-- server-side (tracked in private/ACHIEVEMENTS_AND_ACADEMY_PLAN.md).
--
-- profiles.points_total is a denormalized cache bumped in the same statement.
--
-- Rollback:
--   drop trigger if exists trg_award_points on public.campaign_actions;
--   drop function if exists public.award_points_from_action();
--   drop trigger if exists trg_stamp_sent_at on public.campaign_actions;
--   drop function if exists public.stamp_campaign_action_sent_at();
--   drop table if exists public.achievement_points;
--   alter table public.profiles drop column if exists points_total;

create table if not exists public.achievement_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  points int not null,
  ref_type text,
  ref_id text,
  awarded_at timestamptz not null default now()
);

create index if not exists achievement_points_user_idx
  on public.achievement_points(user_id);

create unique index if not exists achievement_points_uniq
  on public.achievement_points(user_id, kind, ref_id) nulls not distinct;

alter table public.profiles add column if not exists points_total int not null default 0;

alter table public.achievement_points enable row level security;

drop policy if exists achievement_points_self_read on public.achievement_points;
create policy achievement_points_self_read
  on public.achievement_points
  for select
  using (auth.uid() = user_id);
-- No self insert/update/delete: the ledger is written ONLY by the trigger below.

-- Server-stamp sent_at on every insert. Closes the 0218 backdating gap: the
-- 300/day cap windows on sent_at, so a client-supplied past timestamp used to
-- slip the cap. Forcing now() re-arms it (and bounds points padding). Safe —
-- no legit inserter sets sent_at to anything but now() (server actions omit it
-- → default now(); waves/fire.ts sets now()). Fires before award below; order
-- is irrelevant since the cap counts PRIOR rows' (now-stamped) sent_at.
create or replace function public.stamp_campaign_action_sent_at()
returns trigger
language plpgsql
as $$
begin
  new.sent_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stamp_sent_at on public.campaign_actions;
create trigger trg_stamp_sent_at
  before insert on public.campaign_actions
  for each row execute function public.stamp_campaign_action_sent_at();

-- Award points for a real advocacy action as its campaign_actions row lands.
create or replace function public.award_points_from_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  ref text;
  pts int;
  inserted int;
begin
  if new.method = 'call' then
    k := 'call';          ref := new.campaign_id::text;   pts := 12;
  elsif new.campaign_id is not null then
    k := 'campaign_send'; ref := new.campaign_id::text;   pts := 10;
  else
    k := 'direct_email';  ref := new.legislator_id::text; pts := 8;
  end if;

  if ref is null then
    return new; -- no stable ref (e.g. ad-hoc stakeholder) → award nothing
  end if;

  insert into public.achievement_points(user_id, kind, points, ref_type, ref_id)
  values (
    new.user_id, k, pts,
    case when new.campaign_id is not null then 'campaign' else 'official' end,
    ref
  )
  on conflict (user_id, kind, ref_id) do nothing;

  get diagnostics inserted = row_count;
  if inserted > 0 then
    update public.profiles set points_total = points_total + pts where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_award_points on public.campaign_actions;
create trigger trg_award_points
  after insert on public.campaign_actions
  for each row execute function public.award_points_from_action();
