-- ============================================================
-- 0261_coalition_owner_seeds_self
--
-- BUG (reported by a member 2026-10-04, screenshot): creating a coalition failed
-- with "Failed to seed owner membership: new row violates row-level security
-- policy for table coalition_members". 709 failed attempts, 0 coalitions ever.
--
-- Chicken-and-egg: the only INSERT policy on coalition_members is
-- "members: admin insert" (is_coalition_admin(coalition_id)), and a brand-new
-- coalition has no members, so nobody is its admin yet — not even its owner.
--
-- Fix: the coalition's OWNER may insert exactly one kind of row — their own
-- membership with role 'owner'. Proven in a rolled-back transaction before
-- applying: owner seeds self ALLOWED, then adds a member via the existing admin
-- policy ALLOWED; another user making themselves owner of it BLOCKED; seeding
-- someone else as owner BLOCKED; joining as a plain member via this rule BLOCKED.
--
-- Applied directly on 2026-10-05 so the member is unblocked without waiting for
-- a deploy; idempotent so `npm run db:push` re-runs it harmlessly. (#948 also
-- seeds the owner row with the service role; the two are independent.)
--
-- Rollback: drop policy if exists "members: owner seeds self" on public.coalition_members;
-- ============================================================

drop policy if exists "members: owner seeds self" on public.coalition_members;
create policy "members: owner seeds self" on public.coalition_members
  for insert to authenticated
  with check (
    auth.uid() is not null
    and user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1 from public.coalitions c
      where c.id = coalition_id and c.owner_id = auth.uid()
    )
  );
