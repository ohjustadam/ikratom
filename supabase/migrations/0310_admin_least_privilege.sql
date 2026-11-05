-- 0310_admin_least_privilege.sql
--
-- Intent (owner, 2026-11-03): an admin moderates; only the owner can unmask a
-- member or change who holds power. Being an admin must be safe for the admin
-- and for every member, even if an admin account is stolen.
--
-- Before: is_admin() is true for admins AND the owner, and these policies used
-- it, so through the API any admin could
--   - read every member's email, real name, phone, street, city and ZIP
--     (profiles_admin_read_all);
--   - rewrite any other member's row (profiles_admin_update_all): make another
--     account an admin, change their email, name or avatar, or swap the public
--     key their encrypted DMs are sealed to;
--   - read sign-in events and error reports with members' emails and IPs, and
--     the sending address of every letter (auth_events, user_error_reports,
--     personal_send_records).
-- After: all of that is owner-only. Members keep their own rows. Admin screens
-- read and write through server actions that check the admin's permission first
-- and show admins @username, never a real name, email or IP.
--
-- Also owner-only from now on (has_permission restated from 0246, mirrored in
-- src/modules/admin/permissions.ts and kept honest by
-- tests/permission-catalog-sync.test.ts):
--   view_user_emails     members' email addresses
--   issue_temp_password  hands the caller a working password for someone else
--   manage_discord       webhooks that post platform activity to outside servers
--   edit_partners        partner shops and their QR kits
--
-- Rollback:
--   drop policy profiles_owner_read_all on public.profiles;
--   drop policy profiles_owner_update_all on public.profiles;
--   create policy profiles_admin_read_all on public.profiles for select using (is_admin(auth.uid()));
--   create policy profiles_admin_update_all on public.profiles for update using (is_admin(auth.uid()));
--   drop policy auth_events_read_owner on public.auth_events;
--   create policy auth_events_read_admin on public.auth_events for select to authenticated using (is_admin(auth.uid()));
--   drop policy user_error_reports_read_owner on public.user_error_reports;
--   create policy user_error_reports_read_admin on public.user_error_reports for select to authenticated using (is_admin(auth.uid()));
--   drop policy personal_send_records_read on public.personal_send_records;
--   create policy personal_send_records_read on public.personal_send_records for select to authenticated
--     using (user_id = (select auth.uid()) or is_admin((select auth.uid())));
--   then re-run has_permission from 0246.

create or replace function public.is_owner(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_owner from public.profiles where id = uid), false);
$$;

revoke all on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated, service_role;

comment on function public.is_owner(uuid) is
  'True only for the owner (0310). Unlike is_admin(), never true for an admin. Used by the owner-only member-data policies.';

-- profiles: other members' rows are the owner's alone
drop policy if exists profiles_admin_read_all on public.profiles;
drop policy if exists profiles_owner_read_all on public.profiles;
create policy profiles_owner_read_all on public.profiles
  for select using (public.is_owner(auth.uid()));

drop policy if exists profiles_admin_update_all on public.profiles;
drop policy if exists profiles_owner_update_all on public.profiles;
create policy profiles_owner_update_all on public.profiles
  for update using (public.is_owner(auth.uid()));

-- emails and IPs in the security logs
drop policy if exists auth_events_read_admin on public.auth_events;
drop policy if exists auth_events_read_owner on public.auth_events;
create policy auth_events_read_owner on public.auth_events
  for select to authenticated using (public.is_owner(auth.uid()));

drop policy if exists user_error_reports_read_admin on public.user_error_reports;
drop policy if exists user_error_reports_read_owner on public.user_error_reports;
create policy user_error_reports_read_owner on public.user_error_reports
  for select to authenticated using (public.is_owner(auth.uid()));

drop policy if exists personal_send_records_read on public.personal_send_records;
create policy personal_send_records_read on public.personal_send_records
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_owner((select auth.uid())));

-- has_permission: four more owner-reserved keys (restated from 0246)
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
    'export_advocate_pii', 'dispatch_workflows', 'run_sql',
    'view_user_emails', 'issue_temp_password', 'manage_discord', 'edit_partners'
  ];
  v_admin_perms text[] := array[
    -- moderation
    'moderate_forum', 'moderate_lounge', 'moderate_stories',
    'moderate_intel_queue', 'moderate_calls', 'moderate_feedback',
    'review_vendor_applications', 'review_local_rep_requests',
    -- content
    'author_campaigns', 'approve_campaigns', 'edit_campaigns',
    'edit_bills', 'edit_communities',
    'add_local_officials', 'edit_legislators', 'edit_site_content',
    'edit_library', 'edit_academy', 'edit_meetings', 'edit_stance',
    -- user management
    'view_users_list', 'send_password_reset', 'send_magic_link',
    -- data sync
    'sync_legislators', 'run_data_diagnostics',
    -- communications
    'admin_emergency_mode', 'send_announcements',
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
