-- ============================================================
-- 0246_permission_catalog_v2
--
-- Brings has_permission() in line with the expanded TS catalog
-- (src/modules/admin/permissions.ts) now that the granular
-- permission system is actually ENFORCED. Until this point the
-- function existed but nothing called it — the matrix at
-- /admin/users/[id]/permissions recorded intent and nothing else.
--
-- Three changes:
--
-- 1. OWNER FIRST. Previously an explicit user_permissions row was
--    checked before the is_owner short-circuit, so a single
--    `granted=false` row against the owner would deny the owner.
--    The recovery path for that would have been raw SQL — itself
--    an owner-only capability — i.e. a genuine bricking scenario.
--    The owner short-circuit now runs before overrides are read.
--
-- 2. OWNER-RESERVED KEYS. Six capabilities are never delegable to
--    anyone regardless of role or override: role management, the
--    permissions matrix itself, account locking, the advocate PII
--    export, GitHub workflow dispatch, and raw SQL. These are the
--    ones where an admin holding them is an owner in all but name
--    (mint your own admin, seize an account, exfiltrate the
--    membership, or run code on a runner holding the service-role
--    key). A stray override row for one of these is IGNORED, not
--    honored.
--
-- 3. CATALOG SYNC. Both default arrays now match the TS catalog,
--    which grew from 20 keys to 42 so that every admin surface has
--    a key to gate on. tests/permission-catalog-sync.test.ts parses
--    this file and fails CI if the two ever drift.
--
-- No schema change — user_permissions and its RLS are untouched.
-- Rollback: re-run 0083's version of the function.
-- ============================================================

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
  -- Never delegable. Owner only, override or not.
  v_owner_only_perms text[] := array[
    'manage_roles', 'manage_permissions', 'lock_accounts',
    'export_advocate_pii', 'dispatch_workflows', 'run_sql'
  ];
  v_admin_perms text[] := array[
    -- moderation
    'moderate_forum', 'moderate_lounge', 'moderate_stories',
    'moderate_intel_queue', 'moderate_calls', 'moderate_feedback',
    'review_vendor_applications', 'review_local_rep_requests',
    -- content
    'author_campaigns', 'approve_campaigns', 'edit_campaigns',
    'edit_bills', 'edit_communities', 'edit_partners',
    'add_local_officials', 'edit_legislators', 'edit_site_content',
    'edit_library', 'edit_academy', 'edit_meetings', 'edit_stance',
    -- user management
    'view_users_list', 'view_user_emails', 'send_password_reset',
    'send_magic_link', 'issue_temp_password',
    -- data sync
    'sync_legislators', 'run_data_diagnostics',
    -- communications
    'admin_emergency_mode', 'send_announcements', 'manage_discord',
    -- platform
    'view_admin_dashboard', 'view_audit_log', 'view_ops_console',
    'view_security_signals', 'use_ai_editor', 'use_master_edit'
  ];
  v_leader_perms text[] := array[
    'moderate_forum', 'moderate_stories', 'author_campaigns',
    'add_local_officials', 'field_signup', 'view_admin_dashboard'
  ];
begin
  select is_owner, is_admin, is_advocate_leader
    into v_profile
    from public.profiles
   where id = p_user;
  if not found then return false; end if;

  -- 1. Owner holds everything. Checked BEFORE overrides so no revoke,
  --    accidental or malicious, can lock the owner out.
  if v_profile.is_owner then return true; end if;

  -- 2. Owner-reserved keys stop here for everyone else.
  if p_perm = any(v_owner_only_perms) then return false; end if;

  -- 3. Explicit override beats the role default, both directions.
  select granted into v_explicit_grant
    from public.user_permissions
   where user_id = p_user and permission = p_perm;
  if found then
    return coalesce(v_explicit_grant, false);
  end if;

  -- 4. Role defaults.
  if v_profile.is_admin and p_perm = any(v_admin_perms) then return true; end if;
  if v_profile.is_advocate_leader and p_perm = any(v_leader_perms) then return true; end if;

  return false;
end;
$$;

grant execute on function public.has_permission(uuid, text) to authenticated;

comment on function public.has_permission is
  'Resolves whether a user has a given permission. Owner short-circuits first (no lockout), then owner-reserved keys are refused, then explicit user_permissions overrides, then role defaults. Mirrors resolvePermissions() in src/modules/admin/permissions.ts — kept honest by tests/permission-catalog-sync.test.ts.';

-- ============================================================
-- RLS mirror for delegated moderation
--
-- The app-layer gate is now the finer of the two: a granted user
-- passes getAdminContext({ require }) and gets exactly the one
-- capability. But these three tables are guarded by
-- `is_admin(auth.uid())`, so a LEADER the owner granted a
-- moderation permission to would clear the app check and then be
-- silently refused by the database.
--
-- REVOKING never had this problem (the app gate fails closed long
-- before any query runs); this is only about making GRANTS real.
--
-- Each policy gains `or has_permission(auth.uid(), '<the exact
-- permission>')` — not a blanket "is a grantee", so a user granted
-- story moderation gains nothing on rep requests. Admins keep
-- passing via the unchanged is_admin() branch.
--
-- Precedent: legislators_creator_local_write (0008) already lets
-- non-admin leaders write local officials.
--
-- Forum thread/post moderation is NOT here — it runs through the
-- service-role client already, so grants work there without an RLS
-- change.
--
-- Rollback: recreate each policy with only the is_admin() clause.
-- ============================================================

drop policy if exists "reports_admin_all" on public.forum_post_reports;
create policy "reports_admin_all" on public.forum_post_reports
  for all using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'moderate_forum')
  )
  with check (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'moderate_forum')
  );

drop policy if exists "stories_admin_all" on public.kratom_stories;
create policy "stories_admin_all" on public.kratom_stories
  for all using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'moderate_stories')
  )
  with check (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'moderate_stories')
  );

drop policy if exists "rep_requests_admin_update" on public.local_rep_requests;
create policy "rep_requests_admin_update"
  on public.local_rep_requests for update to authenticated
  using (
    public.is_admin(auth.uid())
    or public.has_permission(auth.uid(), 'review_local_rep_requests')
  );
