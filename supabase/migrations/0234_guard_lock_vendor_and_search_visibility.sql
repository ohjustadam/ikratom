-- ============================================================
-- 0234 — Close self-escalation (lock/vendor) + directory enumeration holes
-- ============================================================
-- Security audit 2026-07-10 (adversarially verified). Two independent holes,
-- one shared root cause + one RPC gap:
--
-- ROOT CAUSE (findings #2 HIGH, #3 MEDIUM): profiles_self_write (0001_init:131)
-- is `for update using (auth.uid()=id)` with NO WITH CHECK and no column-level
-- grant, so a user can PATCH ANY column on their OWN row via direct PostgREST —
-- gated ONLY by the guard trigger guard_profiles_self_privilege (0212/0213),
-- whose block-list omitted the moderation-lock and vendor-approval columns.
--   #2: a locked/banned user could `PATCH /rest/v1/profiles {account_locked_at:null}`
--       with their still-valid JWT and self-unlock (proxy.ts enforces the lock only
--       on page nav and EXEMPTS /api/, so PostgREST is never fronted). Ban evasion.
--   #3: any user could `PATCH {vendor_status:'approved'}` and self-grant verified-
--       vendor standing, bypassing admin review (approveVendor).
-- FIX: widen the guard to also block SELF changes to account_locked_at/_reason and
-- a SELF transition into vendor_status='approved' / self-set of the approver stamp.
-- Admin/owner actions write cross-user (auth.uid() <> old.id) and stay allowed;
-- applyForVendorStatus (self → 'pending' + business fields, approver stamp null)
-- stays allowed; service-role (auth.uid() null) stays unguarded.
-- NOTE: password_must_change_at is deliberately NOT guarded here — it is
-- legitimately self-cleared after a real password change (actions-password.ts).
--
-- FINDING #4 (LOW): search_users_by_username (0168) ignores profile_visibility,
-- letting any authenticated user prefix-crawl id+@username+state+public_key of
-- EVERY DM-enabled user, including those who set profile_visibility to
-- private/recruiters_only (0096/0187 promised "only your leader sees you").
-- FIX: add the same profile_visibility='public' gate get_public_profile uses.
--
-- Rollback: re-apply 0213's guard body + the 0168/0233 search_users body.

-- ---- Findings #2 + #3: widen the profiles self-privilege guard ----
create or replace function public.guard_profiles_self_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_owner boolean;
begin
  -- Service-role / no session → trusted (cron + server actions already checked).
  if auth.uid() is null then
    return new;
  end if;

  caller_is_owner := coalesce(
    (select p.is_owner from public.profiles p where p.id = auth.uid()),
    false
  );

  -- 1. is_owner is the master flag: only an owner may grant/revoke it, on ANY row.
  if (new.is_owner is distinct from old.is_owner) and not caller_is_owner then
    raise exception 'only an owner may change owner status';
  end if;

  -- 2. Privilege columns: a user may not change them on their OWN row (admins set
  --    is_admin/is_advocate_leader on OTHER users via the role-grant action).
  if auth.uid() = old.id
     and (new.is_admin           is distinct from old.is_admin
       or new.is_advocate_leader is distinct from old.is_advocate_leader
       or new.intel_tier         is distinct from old.intel_tier
       or new.intel_tier_locked  is distinct from old.intel_tier_locked)
     and not caller_is_owner
  then
    raise exception 'not authorized to modify privilege columns on your own profile';
  end if;

  -- 3. Moderation lock: a user may not lock/unlock their OWN account (self-unlock
  --    = ban evasion). Admins lock OTHER users cross-user, which is allowed.
  if auth.uid() = old.id
     and (new.account_locked_at     is distinct from old.account_locked_at
       or new.account_locked_reason is distinct from old.account_locked_reason)
     and not caller_is_owner
  then
    raise exception 'not authorized to change account lock state on your own profile';
  end if;

  -- 4. Vendor approval: a user may APPLY (self-set status='pending' + business
  --    fields, approver stamp null — applyForVendorStatus) but may NOT self-APPROVE.
  --    Block a self transition INTO 'approved' and any self-set of the approver stamp.
  if auth.uid() = old.id and not caller_is_owner then
    if new.vendor_status = 'approved' and old.vendor_status is distinct from 'approved' then
      raise exception 'vendor approval is admin-only';
    end if;
    if (new.vendor_approved_at is not null and new.vendor_approved_at is distinct from old.vendor_approved_at)
       or (new.vendor_approved_by is not null and new.vendor_approved_by is distinct from old.vendor_approved_by)
    then
      raise exception 'vendor approval fields are admin-only';
    end if;
  end if;

  return new;
end;
$$;

-- ---- Finding #4: gate the DM user-search by profile_visibility ----
create or replace function public.search_users_by_username(p_q text, p_limit integer default 10)
returns table(id uuid, username text, state text, public_key text)
language sql
security definer
set search_path to 'public'
as $$
  select p.id, p.username, p.state, p.public_key
  from public.profiles p
  where p.public_key is not null
    and p.username is not null
    and p.profile_visibility = 'public'
    and p.username ilike (lower(regexp_replace(coalesce(p_q, ''), '^@', '')) || '%')
    and p.id <> auth.uid()
  order by p.username
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;
