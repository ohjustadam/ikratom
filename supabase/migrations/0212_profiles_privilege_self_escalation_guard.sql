-- ============================================================
-- 0212 — Block profiles privilege self-escalation (CRITICAL security fix)
-- ============================================================
-- Threat: `profiles_self_write` (0001_init.sql:131) is `for update using
-- (auth.uid() = id)` with NO `with check`, and `profiles_admin_update_all`
-- (0002:38) likewise. In Postgres, a missing WITH CHECK reuses USING for the
-- new row — but USING only restricts WHICH rows you may target, never WHICH
-- column values you may write. The privilege flags is_admin / is_owner /
-- is_advocate_leader / intel_tier live on this same row. With no trigger and
-- no column-level GRANT revocation, any authenticated user could
--   PATCH /rest/v1/profiles?id=eq.<own_uid>  {"is_owner": true, "is_admin": true}
-- via PostgREST (their own JWT) — the row still satisfies auth.uid()=id, so the
-- write is accepted — and instantly become owner. is_admin(uid) reads these
-- columns, so this is the master key to every admin/owner gate on the platform.
--
-- Fix: a SECURITY DEFINER BEFORE UPDATE trigger that enforces the invariant in
-- the database, independent of (and surviving future edits to) the RLS policies.
-- It is SURGICAL: it only blocks a non-owner end-user editing the privilege
-- columns on THEIR OWN row — exactly the exploit. It does NOT touch:
--   * service-role writes (auth.uid() is null) — all legit admin/owner
--     promotion flows go through createServiceRoleClient() (see
--     src/modules/admin/user-actions.ts), so they bypass RLS and this guard.
--   * an owner editing their own row (caller is_owner → allowed).
--   * admin moderation of OTHER users' rows (auth.uid() <> old.id → untouched;
--     still gated by profiles_admin_update_all USING is_admin()).
--
-- Rollback:
--   drop trigger if exists trg_profiles_guard_self_privilege on public.profiles;
--   drop function if exists public.guard_profiles_self_privilege();

create or replace function public.guard_profiles_self_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only an end-user editing their OWN row is a self-escalation risk.
  -- Service-role (auth.uid() null) and cross-user admin edits pass through.
  if auth.uid() is distinct from old.id then
    return new;
  end if;

  -- Editing your own row: privilege columns must not change unless you are
  -- already the owner (the one role allowed to manage privilege flags).
  if (new.is_admin            is distinct from old.is_admin
   or new.is_owner            is distinct from old.is_owner
   or new.is_advocate_leader  is distinct from old.is_advocate_leader
   or new.intel_tier          is distinct from old.intel_tier
   or new.intel_tier_locked   is distinct from old.intel_tier_locked)
     and not coalesce(
       (select p.is_owner from public.profiles p where p.id = auth.uid()),
       false
     )
  then
    raise exception 'not authorized to modify privilege columns on your own profile';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_guard_self_privilege on public.profiles;
create trigger trg_profiles_guard_self_privilege
  before update on public.profiles
  for each row execute function public.guard_profiles_self_privilege();
