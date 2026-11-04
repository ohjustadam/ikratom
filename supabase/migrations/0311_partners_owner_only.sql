-- 0311: partner shop records are the owner's alone (owner, 2026-11-03).
--
-- The owner's own business is a partner record, and it must not be listed or
-- advertised anywhere. Two holes closed:
--   1. partners_public (0043) was granted to anon + authenticated, so anyone
--      holding the site's public API key could list every partner shop's name,
--      city and tagline. No page reads it; the /partners/<host> stats page reads
--      campaign_actions only. Grants revoked; the view stays for rollback.
--   2. partners_admin_all let every admin read and edit the table, including
--      contact name, email and phone. edit_partners is owner-only since 0310,
--      so the table policy now matches: owner only (public.is_owner, 0310).
--
-- Rollback:
--   grant select on public.partners_public to anon, authenticated;
--   drop policy if exists "partners_owner_all" on public.partners;
--   create policy "partners_admin_all" on public.partners for all to authenticated
--     using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

revoke all on public.partners_public from anon, authenticated;

drop policy if exists "partners_admin_all" on public.partners;
drop policy if exists "partners_owner_all" on public.partners;
create policy "partners_owner_all"
  on public.partners
  for all
  to authenticated
  using (public.is_owner((select auth.uid())))
  with check (public.is_owner((select auth.uid())));
