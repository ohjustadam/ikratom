-- ============================================================
-- 0014 — Public profile lookup
-- ============================================================
-- profiles.* has self-only RLS so users can't read others' addresses, etc.
-- This SECURITY DEFINER function exposes ONLY the columns safe for public
-- display: name, state, role badges, joined date. NEVER address, email, phone.

create or replace function public.get_public_profile(p_id uuid)
returns table (
  id uuid,
  full_name text,
  state text,
  city text,
  is_owner boolean,
  is_admin boolean,
  is_advocate_leader boolean,
  is_shop_owner boolean,
  shop_name text,
  is_medical_professional boolean,
  public_key text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.state,
    p.city,
    p.is_owner,
    p.is_admin,
    p.is_advocate_leader,
    p.is_shop_owner,
    p.shop_name,
    p.is_medical_professional,
    p.public_key,
    p.created_at
  from public.profiles p
  where p.id = p_id;
$$;

grant execute on function public.get_public_profile(uuid) to anon, authenticated;
