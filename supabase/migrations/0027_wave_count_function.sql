-- ============================================================
-- 0027 — Public wave-count function
-- ============================================================
-- The aggregate view added in 0026 inherits RLS from
-- campaign_wave_signups, so a regular user can only see their own row in
-- the count(*) query. We need the public counter on the campaign page to
-- show the *real* total, not just "1 if you joined, 0 if not".
--
-- Solution: a SECURITY DEFINER function that returns just the count for
-- one wave_id. It bypasses RLS but only exposes a single integer — no
-- per-user identifying data.
-- ============================================================

create or replace function public.get_wave_signup_count(p_wave_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.campaign_wave_signups
  where wave_id = p_wave_id;
$$;

grant execute on function public.get_wave_signup_count(uuid) to anon, authenticated;
