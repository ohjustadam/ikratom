-- 0305_my_campaign_history.sql
--
-- WHY: a member asked for a record of which campaigns he has already acted on
-- and when, so he stops having to remember them (Paul, 2026-10-31: "Ive done
-- several and i have to remember the ones ive done so i dont accidentally redo
-- em"). /campaigns now marks each card he has sent with the date and count.
--
-- One row per campaign, aggregated here, because the raw rows are one per email:
-- a single 138-letter send is 138 campaign_actions rows, and shipping all of
-- them to the browser on every /campaigns view would be egress for nothing.
--
-- SECURITY INVOKER on purpose: the existing actions_self_read policy (0001) is
-- what limits it to the caller's own rows. The where-clause only keeps the
-- planner on campaign_actions_user_idx.
--
-- ROLLBACK: drop function if exists public.my_campaign_history();

create or replace function public.my_campaign_history()
returns table (campaign_id uuid, last_sent_at timestamptz, sends bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.campaign_id, max(a.sent_at), count(*)
  from public.campaign_actions a
  where a.user_id = auth.uid()
    and a.campaign_id is not null
  group by a.campaign_id
$$;

revoke all on function public.my_campaign_history() from public, anon;
grant execute on function public.my_campaign_history() to authenticated;
