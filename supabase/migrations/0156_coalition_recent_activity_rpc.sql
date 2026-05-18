-- ============================================================
-- 0156_coalition_recent_activity_rpc
--
-- Aggregate activity view for the Coalition Layer (#389). Members
-- of a coalition can see how their teammates are coordinating —
-- WITHOUT per-user attribution. Privacy posture:
--   - Aggregate counts only ("5 sends to Sen. Smith this week")
--   - Never expose individual user_id → legislator_id pairings
--   - Members-only access (RPC checks coalition_members)
--
-- Two RPCs:
--   1. coalition_activity_summary(coalition_id, days) →
--      total sends, distinct members active, distinct legislators
--      contacted, distinct campaigns acted on
--   2. coalition_top_legislators(coalition_id, days, limit) →
--      top-N most-contacted legislators with send counts
--
-- Both gated to coalition members via the helper from migration 0153.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS coalition_activity_summary;
--   DROP FUNCTION IF EXISTS coalition_top_legislators;

create or replace function public.coalition_activity_summary(
  p_coalition_id uuid,
  p_days int default 7
)
returns table (
  total_sends bigint,
  active_members bigint,
  legislators_contacted bigint,
  campaigns_used bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_coalition_member(p_coalition_id) then
    raise exception 'not a member of this coalition';
  end if;

  return query
    select
      count(ca.id)::bigint               as total_sends,
      count(distinct ca.user_id)::bigint as active_members,
      count(distinct ca.legislator_id)::bigint as legislators_contacted,
      count(distinct ca.campaign_id)::bigint as campaigns_used
    from public.campaign_actions ca
    join public.coalition_members cm
      on cm.user_id = ca.user_id
     and cm.coalition_id = p_coalition_id
    where ca.sent_at > now() - (p_days || ' days')::interval;
end;
$$;

grant execute on function public.coalition_activity_summary(uuid, int) to authenticated;

-- Top legislators contacted by the coalition. Aggregate only —
-- returns legislator names + counts, never user_ids.
create or replace function public.coalition_top_legislators(
  p_coalition_id uuid,
  p_days int default 7,
  p_limit int default 8
)
returns table (
  legislator_id uuid,
  full_name text,
  state text,
  role text,
  send_count bigint,
  distinct_senders bigint
)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'not authenticated'; end if;
  if not public.is_coalition_member(p_coalition_id) then
    raise exception 'not a member of this coalition';
  end if;

  return query
    select
      l.id                                   as legislator_id,
      l.full_name,
      l.state,
      l.role,
      count(ca.id)::bigint                   as send_count,
      count(distinct ca.user_id)::bigint     as distinct_senders
    from public.campaign_actions ca
    join public.coalition_members cm
      on cm.user_id = ca.user_id
     and cm.coalition_id = p_coalition_id
    join public.legislators l on l.id = ca.legislator_id
    where ca.sent_at > now() - (p_days || ' days')::interval
    group by l.id, l.full_name, l.state, l.role
    order by send_count desc, distinct_senders desc
    limit p_limit;
end;
$$;

grant execute on function public.coalition_top_legislators(uuid, int, int) to authenticated;
