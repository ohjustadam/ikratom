-- ============================================================
-- 0242 — power_users(uuid[]) batch check (checkmark on public lists)
-- ============================================================
-- The public power-user checkmark (0241) shows on public profiles via
-- is_power_user(uuid). List surfaces (forum threads/posts, etc.) render many
-- authors at once — this batch variant returns the subset of the given ids
-- that are certified, so a surface resolves all its authors in ONE call
-- instead of N. Exposes only ids (never the timestamp or any other column).
--
-- Rollback: drop function public.power_users(uuid[]);

create or replace function public.power_users(p_ids uuid[])
returns table(id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select id from public.profiles
   where id = any(p_ids) and power_user_at is not null;
$$;
revoke all on function public.power_users(uuid[]) from public;
grant execute on function public.power_users(uuid[]) to anon, authenticated;
