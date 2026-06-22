-- ============================================================
-- 0213 — Lock is_owner against cross-user promotion (follow-up to 0212)
-- ============================================================
-- 0212 added a BEFORE UPDATE trigger blocking a non-owner from changing the
-- privilege columns on their OWN row (the critical self-escalation). But
-- `profiles_admin_update_all` (0002:38) still has no WITH CHECK, so a rogue
-- ADMIN could PATCH ANOTHER user's row to is_owner=true via direct PostgREST.
-- The app-side role-grant action (src/modules/admin/user-actions.ts) correctly
-- forbids non-owners from setting is_owner, but RLS does not — so a colluding
-- sock-puppet account promoted to owner = full takeover. (Pen-test finding #4.)
--
-- This widens the existing guard function so is_owner can ONLY change when the
-- caller is themselves an owner — for BOTH self and cross-user edits. The other
-- privilege columns (is_admin / is_advocate_leader / intel_tier) keep the
-- 0212 self-only guard, because admins LEGITIMATELY grant is_admin /
-- is_advocate_leader to OTHER users via the role-grant action, which writes
-- through the admin's authenticated session (auth.uid() = the admin, != the
-- target row) — so a blanket owner-only rule would break that real flow.
-- Service-role writes (auth.uid() null) stay unguarded (trusted cron/server).
--
-- Trigger trg_profiles_guard_self_privilege (0212) already points at this
-- function, so CREATE OR REPLACE swaps in the wider behavior with no DDL churn.
--
-- Rollback: re-apply 0212's function body (the self-only guard).

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

  -- 1. is_owner is the master flag: only an owner may grant or revoke it, on ANY
  --    row. Blocks both self-escalation and rogue-admin cross-user promotion.
  if (new.is_owner is distinct from old.is_owner) and not caller_is_owner then
    raise exception 'only an owner may change owner status';
  end if;

  -- 2. The other privilege columns: a user may not change them on their OWN row
  --    unless they are owner (self-escalation). Admins legitimately set
  --    is_admin / is_advocate_leader on OTHER users via the role-grant action.
  if auth.uid() = old.id
     and (new.is_admin           is distinct from old.is_admin
       or new.is_advocate_leader is distinct from old.is_advocate_leader
       or new.intel_tier         is distinct from old.intel_tier
       or new.intel_tier_locked  is distinct from old.intel_tier_locked)
     and not caller_is_owner
  then
    raise exception 'not authorized to modify privilege columns on your own profile';
  end if;

  return new;
end;
$$;
