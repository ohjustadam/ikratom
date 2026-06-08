-- 0188: Lock down site_settings read access (was anon-readable).
--
-- Finding (security audit): migration 0110 created site_settings with a
-- SELECT policy USING (true) — i.e. ANY anonymous caller could read the whole
-- table (feature flags, the admin `note` column, and any future config) via
-- the public REST API + published anon key. That's an information-disclosure
-- surface: rollout/feature detection + admin notes exposed to strangers.
--
-- The app does NOT read this table from any client or anon path (zero
-- references in src/ or scripts/), and all legitimate server/cron access uses
-- the service-role client, which bypasses RLS. So restricting SELECT to admins
-- removes the anon exposure with no functional impact.
--
-- If a genuinely PUBLIC flag is ever needed, expose it via a SECURITY DEFINER
-- function that returns only the whitelisted key(s) — never re-open the whole
-- table to anon.
--
-- Rollback:
--   drop policy if exists "Admin read site settings" on public.site_settings;
--   create policy "Public read site settings" on public.site_settings
--     for select using (true);

drop policy if exists "Public read site settings" on public.site_settings;

create policy "Admin read site settings"
  on public.site_settings
  for select
  using (public.is_admin(auth.uid()));
