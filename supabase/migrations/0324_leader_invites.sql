-- 0324_leader_invites.sql
--
-- Owner, 2026-11-17. A leader promotion the safeguard refuses should not just
-- vanish. On 11-17 the owner promoted a member who had not set up 2FA or
-- filled in her name and address; setUserRoles refused, and the only sign was
-- a small line on /admin/users.
--
-- The safeguard stays (verifyUserForPromotion: confirmed email, 48 h old,
-- 2FA, full name + street + city + ZIP). What changes: the owner can INVITE.
-- One row per invited member. The member sees a checklist of what is left;
-- the role applies on its own the first time they are verified, from the
-- server, with the normal leader notification and tour.
--
-- Writes go through the service role only, after the owner check in
-- src/modules/admin/leader-invite-actions.ts. A member may read their own
-- row; nobody else may read any. There is deliberately NO column on profiles:
-- profiles allows self-updates, and an invite a member could set on their
-- own row would be a self-promotion.
--
-- Rollback: drop table public.leader_invites;

create table if not exists public.leader_invites (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz
);

comment on table public.leader_invites is
  'Owner invitations to become an Advocate Leader. Applied automatically once the member passes verifyUserForPromotion. Service-role writes only.';

alter table public.leader_invites enable row level security;

drop policy if exists "leader_invites_self_read" on public.leader_invites;
create policy "leader_invites_self_read" on public.leader_invites
  for select to authenticated
  using (user_id = auth.uid());

-- New public tables get no default grants after 2026-10-30: grant explicitly.
revoke all on public.leader_invites from anon, authenticated;
grant select on public.leader_invites to authenticated;
grant all on public.leader_invites to service_role;
