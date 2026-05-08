-- ============================================================
-- 0069_intel_trust_tiers
--
-- Phase 3c: Trust system for advocate-submitted intel tips.
--
-- Why: as the platform grows, every approved tip is essentially a
-- vote of confidence in that submitter's signal-to-noise. Pre-Phase
-- 3c we treat all submitters identically — each tip waits in the
-- admin queue. With trust tiers, repeat reporters with clean records
-- get fast-tracked: their tips bypass the queue and auto-publish
-- (still subject to the auto-campaign trigger and audit log).
--
-- Tiers:
--   rookie           — default; tips go through full moderation queue
--   field_reporter   — 3+ approved tips, 0 rejected → tips still queue
--                      but show a "verified field reporter" badge
--                      so admins can triage faster
--   trusted_reporter — 10+ approved, ≤1 rejected → tips auto-approve
--                      on submit (moderation_status=approved). They
--                      land on /pulse immediately and the Phase 4
--                      trigger spawns the campaign.
--
-- Promotion + counter maintenance happens via trigger on
-- policy_alerts UPDATE so we don't depend on app code remembering
-- to update tiers.
--
-- ROLLBACK: drop the trigger + functions; columns can stay.
-- ============================================================

-- ----------------------------------------
-- 1. Profile counters + tier
-- ----------------------------------------
alter table public.profiles
  add column if not exists intel_approved_count int not null default 0,
  add column if not exists intel_rejected_count int not null default 0,
  add column if not exists intel_last_approved_at timestamptz,
  add column if not exists intel_tier text not null default 'rookie',
  add column if not exists intel_tier_locked boolean not null default false;
  -- intel_tier_locked = true: admin manually overrode tier; auto-promotion
  -- ignores this profile until lock is cleared. Use for ban-protection or
  -- manual promotion of a known-good submitter who hasn't hit the threshold.

alter table public.profiles
  drop constraint if exists profiles_intel_tier_chk;
alter table public.profiles
  add constraint profiles_intel_tier_chk
  check (intel_tier in ('rookie', 'field_reporter', 'trusted_reporter'));

create index if not exists ix_profiles_intel_tier
  on public.profiles (intel_tier)
  where intel_tier <> 'rookie';

-- ----------------------------------------
-- 2. Tier calculation
-- ----------------------------------------
create or replace function public.calc_intel_tier(p_approved int, p_rejected int)
returns text
language sql
immutable
as $$
  select case
    when p_approved >= 10 and p_rejected <= 1 then 'trusted_reporter'
    when p_approved >=  3 and p_rejected =  0 then 'field_reporter'
    else 'rookie'
  end;
$$;

-- ----------------------------------------
-- 3. Trigger — maintain counters + tier on alert moderation
-- ----------------------------------------
create or replace function public.update_intel_tier_on_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_approved int;
  v_rejected int;
  v_locked boolean;
  v_new_tier text;
begin
  -- Only act on intel_tip rows that have a submitter and just transitioned
  -- pending → approved or pending → rejected. Other moderation paths (e.g.
  -- system-generated alerts approved on insert) are not credited.
  if new.kind not in ('intel_tip', 'bill_event', 'bop_hearing', 'fda_action',
                      'dea_action', 'ag_enforcement', 'news_break') then
    return new;
  end if;
  v_uid := new.submitted_by_user_id;
  if v_uid is null then return new; end if;
  if old.moderation_status = new.moderation_status then return new; end if;
  if old.moderation_status <> 'pending' then return new; end if;

  -- Increment the right counter
  if new.moderation_status = 'approved' then
    update public.profiles
       set intel_approved_count = intel_approved_count + 1,
           intel_last_approved_at = now()
     where id = v_uid
    returning intel_approved_count, intel_rejected_count, intel_tier_locked
        into v_approved, v_rejected, v_locked;
  elsif new.moderation_status = 'rejected' then
    update public.profiles
       set intel_rejected_count = intel_rejected_count + 1
     where id = v_uid
    returning intel_approved_count, intel_rejected_count, intel_tier_locked
        into v_approved, v_rejected, v_locked;
  else
    return new;
  end if;

  -- Auto-promote/demote if not locked
  if not coalesce(v_locked, false) then
    v_new_tier := public.calc_intel_tier(v_approved, v_rejected);
    update public.profiles
       set intel_tier = v_new_tier
     where id = v_uid
       and intel_tier <> v_new_tier;
  end if;

  return new;
exception
  when others then
    -- Never block the alert moderation on counter-update failure
    raise warning 'update_intel_tier_on_moderation failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_intel_tier_on_moderation on public.policy_alerts;
create trigger trg_intel_tier_on_moderation
  after update of moderation_status
  on public.policy_alerts
  for each row
  execute function public.update_intel_tier_on_moderation();

comment on trigger trg_intel_tier_on_moderation on public.policy_alerts is
  'Maintains profiles.intel_approved_count / intel_rejected_count / intel_tier whenever an alert with a submitter transitions out of pending. See migration 0069.';

-- ----------------------------------------
-- 4. RLS — let trusted reporters insert pre-approved
-- ----------------------------------------
-- Existing policy `policy_alerts_self_submit` requires moderation_status='pending'.
-- Trusted reporters get a parallel insert policy that allows 'approved'.
drop policy if exists policy_alerts_trusted_self_submit on public.policy_alerts;
create policy policy_alerts_trusted_self_submit
  on public.policy_alerts
  for insert
  to authenticated
  with check (
    submitted_by_user_id = auth.uid()
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and p.intel_tier = 'trusted_reporter'
    )
  );

-- ----------------------------------------
-- 5. Backfill counters for any existing approved/rejected intel_tips
-- ----------------------------------------
-- Idempotent: resets counters then recomputes from history. Safe to re-run.
update public.profiles
   set intel_approved_count = 0,
       intel_rejected_count = 0,
       intel_last_approved_at = null;

with approvals as (
  select submitted_by_user_id as uid, count(*) as n,
         max(coalesce(moderated_at, created_at)) as last_at
    from public.policy_alerts
   where submitted_by_user_id is not null
     and moderation_status = 'approved'
     and kind in ('intel_tip','bill_event','bop_hearing','fda_action',
                  'dea_action','ag_enforcement','news_break')
   group by 1
)
update public.profiles p
   set intel_approved_count = a.n,
       intel_last_approved_at = a.last_at
  from approvals a
 where p.id = a.uid;

with rejections as (
  select submitted_by_user_id as uid, count(*) as n
    from public.policy_alerts
   where submitted_by_user_id is not null
     and moderation_status = 'rejected'
     and kind in ('intel_tip','bill_event','bop_hearing','fda_action',
                  'dea_action','ag_enforcement','news_break')
   group by 1
)
update public.profiles p
   set intel_rejected_count = r.n
  from rejections r
 where p.id = r.uid;

-- Recompute tiers (skip locked)
update public.profiles
   set intel_tier = public.calc_intel_tier(intel_approved_count, intel_rejected_count)
 where not intel_tier_locked
   and intel_tier <> public.calc_intel_tier(intel_approved_count, intel_rejected_count);
