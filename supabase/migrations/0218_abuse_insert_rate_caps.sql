-- ============================================================
-- 0218 — DB-layer insert rate caps on campaign_actions + call_sessions
-- ============================================================
-- Pen-test ABUSE-02 / ABUSE-03 (MED). Both tables already enforce
-- `with check (auth.uid() = user_id)` on INSERT, so a user CANNOT log rows as
-- someone else (no impersonation). The residual gap: a user can bypass the
-- APPLICATION-layer daily cap (DAILY_SEND_CAP=100 / call rate limit) by inserting
-- straight through PostgREST with their own JWT, padding their own row count —
-- which inflates the PUBLIC counters (homepage "emails sent" via homepage_stats(),
-- the /calls leaderboard).
--
-- Fix: BEFORE INSERT triggers enforce a GENEROUS per-user daily cap in the DB so
-- the guarantee holds on every path. Caps are set well ABOVE legitimate usage
-- (3x the app's 100/day send cap; 100 calls/day) so a real advocate is never
-- blocked — only scripted mass-inflation. Service-role (cron) bypasses
-- (auth.uid() null). Note: the window keys off the row's own timestamp, so a
-- determined attacker spreading backdated timestamps could still pad the all-time
-- total; making the public counters intrinsically robust (distinct-user / recency
-- weighted) is the deeper follow-up — this closes the trivial burst path.
--
-- Rollback: drop the two triggers + functions.

create or replace function public.guard_campaign_action_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service-role / cron
  if (
    select count(*) from public.campaign_actions
    where user_id = auth.uid() and sent_at > now() - interval '1 day'
  ) >= 300 then
    raise exception 'daily action limit reached — please try again tomorrow';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_campaign_action_rate on public.campaign_actions;
create trigger trg_guard_campaign_action_rate
  before insert on public.campaign_actions
  for each row execute function public.guard_campaign_action_rate();

create or replace function public.guard_call_session_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if; -- service-role / cron
  if (
    select count(*) from public.call_sessions
    where user_id = auth.uid() and created_at > now() - interval '1 day'
  ) >= 100 then
    raise exception 'daily call-log limit reached — please try again tomorrow';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_call_session_rate on public.call_sessions;
create trigger trg_guard_call_session_rate
  before insert on public.call_sessions
  for each row execute function public.guard_call_session_rate();
