-- ============================================================
-- 0044_vendor_accounts
--
-- Adds verified-vendor support to profiles. See docs/VENDOR_ACCOUNTS.md
-- for the full design (Option A: single account, dual signature).
--
-- Workflow:
--   1. User submits an application from /account/vendor (sets status='pending')
--   2. Admin reviews at /admin/vendor-applications
--   3. Approve → status='approved', business hat selectable on campaign sends
--   4. Reject → status='rejected', user sees reason, can re-apply 30 days later
--
-- Behavior gates:
--   - Application requires shop_name + role + city + state at minimum
--   - Re-apply blocked while status='pending' OR (status='rejected' AND
--     vendor_application_at < now() - 30 days)
--   - Only verified-vendor users see the "send as business" toggle on
--     campaign actions
-- ============================================================

alter table public.profiles
  add column if not exists vendor_status text
    check (vendor_status in ('none','pending','approved','rejected'))
    default 'none' not null,
  add column if not exists vendor_business_name text
    check (vendor_business_name is null or length(vendor_business_name) between 1 and 120),
  add column if not exists vendor_business_role text
    check (vendor_business_role is null or length(vendor_business_role) between 1 and 80),
  add column if not exists vendor_business_city text
    check (vendor_business_city is null or length(vendor_business_city) <= 80),
  add column if not exists vendor_business_state text
    check (vendor_business_state is null or vendor_business_state ~ '^[A-Z]{2}$'),
  add column if not exists vendor_business_website text,
  add column if not exists vendor_application_at timestamptz,
  add column if not exists vendor_approved_at timestamptz,
  add column if not exists vendor_approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists vendor_rejection_reason text;

-- Index for the admin queue: pending applications, oldest first.
create index if not exists idx_profiles_vendor_pending
  on public.profiles (vendor_application_at)
  where vendor_status = 'pending';

-- ============================================================
-- Public-safe getter for vendor info on /profile/[id]
-- (Already-existing get_public_profile RPC returns is_admin etc; we
-- extend it with vendor fields. Postgres requires DROP before adding
-- columns to a function's OUT parameters.)
-- ============================================================
drop function if exists public.get_public_profile(uuid);
drop function if exists public.get_public_profiles(uuid[]);

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
  created_at timestamptz,
  vendor_status text,
  vendor_business_name text,
  vendor_business_role text,
  vendor_business_city text,
  vendor_business_state text,
  vendor_business_website text
)
language sql
security definer
stable
set search_path = public
as $$
  select id, full_name, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         vendor_status,
         case when vendor_status = 'approved' then vendor_business_name else null end,
         case when vendor_status = 'approved' then vendor_business_role else null end,
         case when vendor_status = 'approved' then vendor_business_city else null end,
         case when vendor_status = 'approved' then vendor_business_state else null end,
         case when vendor_status = 'approved' then vendor_business_website else null end
    from public.profiles
   where id = p_id;
$$;

-- Same shape for the batched version.
create or replace function public.get_public_profiles(p_ids uuid[])
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
  created_at timestamptz,
  vendor_status text,
  vendor_business_name text,
  vendor_business_role text,
  vendor_business_city text,
  vendor_business_state text,
  vendor_business_website text
)
language sql
security definer
stable
set search_path = public
as $$
  select id, full_name, state, city, is_owner, is_admin, is_advocate_leader,
         is_shop_owner, shop_name, is_medical_professional, public_key, created_at,
         vendor_status,
         case when vendor_status = 'approved' then vendor_business_name else null end,
         case when vendor_status = 'approved' then vendor_business_role else null end,
         case when vendor_status = 'approved' then vendor_business_city else null end,
         case when vendor_status = 'approved' then vendor_business_state else null end,
         case when vendor_status = 'approved' then vendor_business_website else null end
    from public.profiles
   where id = any(p_ids);
$$;

grant execute on function public.get_public_profile(uuid) to authenticated;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;
