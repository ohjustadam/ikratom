-- ============================================================
-- 0208 — Intel-lockdown tier upgrade: gate stance on the VERIFIED tier
-- ============================================================
-- 0205 gated legislator_kratom_stance reads to "any logged-in user", which
-- stops anonymous scraping but still lets an opponent who simply signs up
-- read our champion/hostile classification + rationale. This narrows the
-- gate to the VERIFIED trust tier (PR4): confirmed email + complete profile
-- + 2FA enrolled + account >= 48h. Campaign creators (admin/owner/leader)
-- always retain access. Mirrors the app-layer logic in
-- src/modules/auth/trust-tier.ts (getTrustTier / verifyUserForPromotion).
--
-- Effect: until a user verifies, stance dots disappear for them — only
-- creators + fully-verified advocates see stance. This is the intended,
-- owner-approved tightening (a drive-by opponent won't complete the gauntlet).
--
-- Rollback: drop policy "Verified read legislator stance"; recreate
--   create policy "Authed read legislator stance"
--     on public.legislator_kratom_stance for select to authenticated using (true);
--   drop function public.is_verified(uuid);
-- ============================================================

-- SECURITY DEFINER so RLS can call it; reads auth.users + auth.mfa_factors
-- (only the function owner can see those) + the public profile. Fail-closed:
-- coalesce to false if the user row is missing.
create or replace function public.is_verified(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select
        u.email_confirmed_at is not null
        and u.created_at <= now() - interval '48 hours'
        and exists (
          select 1 from auth.mfa_factors f
          where f.user_id = uid and f.status = 'verified'
        )
        and exists (
          select 1 from public.profiles p
          where p.id = uid
            and coalesce(p.full_name, '') <> ''
            and coalesce(p.street, '') <> ''
            and coalesce(p.city, '') <> ''
            and coalesce(p.state, '') <> ''
            and coalesce(p.zip, '') <> ''
        )
      from auth.users u
      where u.id = uid
    ),
    false
  );
$$;

grant execute on function public.is_verified(uuid) to anon, authenticated;

-- Repoint the stance read policy from any-login → verified-or-creator.
drop policy if exists "Authed read legislator stance" on public.legislator_kratom_stance;
create policy "Verified read legislator stance"
  on public.legislator_kratom_stance
  for select
  to authenticated
  using (
    public.is_campaign_creator(auth.uid())
    or public.is_verified(auth.uid())
  );
