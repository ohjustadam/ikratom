-- ============================================================
-- 0048_public_homepage_stats
--
-- The homepage <ImpactStats> server component does six count(*)
-- queries against profiles, campaign_actions, campaigns, and bills.
-- Two of those tables are RLS-gated to "self_read" only — so anon
-- visitors saw 0 advocates and 0 emails sent because RLS evaluated
-- the count against rows visible to anon (zero).
--
-- This RPC is SECURITY DEFINER so it executes as the owner role,
-- bypasses RLS, and returns just the aggregate numbers — no row
-- data, no PII. Safe to expose to anon.
--
-- Bills and campaigns remain public-read so we leave their direct
-- count queries alone; this RPC includes them for parity (one call
-- vs six). The component will switch to a single RPC call.
-- ============================================================

create or replace function public.homepage_stats()
returns table (
  advocates int,
  emails_sent int,
  calls_made int,
  active_campaigns int,
  active_anti_bills int,
  states_with_campaigns int
)
language sql
security definer
stable
set search_path = public
as $$
  select
    (select count(*) from public.profiles)::int as advocates,
    (select count(*) from public.campaign_actions where method != 'call' or method is null)::int as emails_sent,
    (select count(*) from public.campaign_actions where method = 'call')::int as calls_made,
    (select count(*) from public.campaigns where active = true)::int as active_campaigns,
    (select count(*) from public.bills
       where active = true
         and kratom_relevance = 'anti'
         and status not in ('enacted','dead'))::int as active_anti_bills,
    (select count(distinct state) from public.campaigns
       where active = true and state is not null)::int as states_with_campaigns;
$$;

-- Public-safe: anon needs to call this to render the homepage stats.
revoke all on function public.homepage_stats() from public;
grant execute on function public.homepage_stats() to anon, authenticated;
