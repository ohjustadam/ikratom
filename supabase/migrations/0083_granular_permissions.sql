-- ============================================================
-- 0083_granular_permissions
--
-- Owner-controlled granular permissions on top of the existing
-- is_admin / is_owner / is_advocate_leader flag triad.
--
-- The flag-triad keeps working as-is (most code paths check them
-- directly). This adds a per-user override matrix the owner can
-- toggle on /admin/users → Permissions panel.
--
-- Default behavior: a user with is_admin=true gets ALL admin perms
-- automatically (computed at runtime). The override matrix can:
--   1. Grant a specific permission to a non-admin (rare; case-by-
--      case "trusted contributor" grants)
--   2. REVOKE a permission from an admin (e.g. demote a specific
--      capability without yanking their whole admin role)
--
-- Owner can edit. Admins can VIEW the matrix but cannot edit it
-- (RLS enforced). Audit-logged.
-- ============================================================

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null,                  -- key from PERMISSION_CATALOG (TS-side enum)
  granted boolean not null,                  -- true = explicit grant, false = explicit deny
  granted_by uuid references public.profiles(id) on delete set null,
  reason text,                               -- audit context: why owner granted/revoked
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, permission)
);

create index if not exists ix_user_permissions_user
  on public.user_permissions (user_id);
create index if not exists ix_user_permissions_grantor
  on public.user_permissions (granted_by, created_at desc);

-- ----------------------------------------
-- RLS — owner-only write, admin-readable, user can see their own
-- ----------------------------------------
alter table public.user_permissions enable row level security;

drop policy if exists user_permissions_self_read on public.user_permissions;
create policy user_permissions_self_read on public.user_permissions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
  );

drop policy if exists user_permissions_owner_write on public.user_permissions;
create policy user_permissions_owner_write on public.user_permissions
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner));

-- ----------------------------------------
-- updated_at trigger
-- ----------------------------------------
create or replace function public.touch_user_permissions()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_user_permissions_touch on public.user_permissions;
create trigger trg_user_permissions_touch
  before update on public.user_permissions
  for each row execute function public.touch_user_permissions();

-- ----------------------------------------
-- has_permission(user_id, permission) helper
-- ----------------------------------------
-- Resolution order (highest priority first):
--   1. Explicit user_permissions row (granted=true → yes, granted=false → no)
--   2. is_owner → yes (owner gets everything)
--   3. is_admin AND permission is in admin defaults → yes
--   4. is_advocate_leader AND permission is in leader defaults → yes
--   5. otherwise no
--
-- Admin/leader default permission sets are inlined here as arrays.
-- Keep TS-side PERMISSION_CATALOG in sync with these.
-- ----------------------------------------
create or replace function public.has_permission(p_user uuid, p_perm text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_explicit_grant boolean;
  v_profile record;
  v_admin_perms text[] := array[
    'moderate_forum', 'moderate_lounge', 'moderate_stories',
    'approve_campaigns', 'edit_campaigns', 'edit_bills',
    'sync_legislators', 'add_local_officials',
    'send_password_reset', 'send_magic_link',
    'view_audit_log', 'view_users_list', 'view_user_emails',
    'moderate_intel_queue', 'edit_communities', 'edit_partners',
    'admin_emergency_mode', 'view_admin_dashboard'
  ];
  v_leader_perms text[] := array[
    'author_campaigns', 'moderate_forum', 'moderate_stories',
    'add_local_officials', 'field_signup', 'view_admin_dashboard'
  ];
begin
  -- 1. Explicit override
  select granted into v_explicit_grant
    from public.user_permissions
   where user_id = p_user and permission = p_perm;
  if found then
    return coalesce(v_explicit_grant, false);
  end if;

  -- 2-5. Role-based defaults
  select is_owner, is_admin, is_advocate_leader
    into v_profile
    from public.profiles
   where id = p_user;
  if not found then return false; end if;

  if v_profile.is_owner then return true; end if;
  if v_profile.is_admin and p_perm = any(v_admin_perms) then return true; end if;
  if v_profile.is_advocate_leader and p_perm = any(v_leader_perms) then return true; end if;

  return false;
end;
$$;

grant execute on function public.has_permission(uuid, text) to authenticated;

comment on function public.has_permission is
  'Resolves whether a user has a given permission. Checks explicit user_permissions overrides first, then falls back to role-based defaults. See migration 0083 + src/modules/admin/permissions.ts for the catalog.';
