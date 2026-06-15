-- ============================================================
-- 0205 — Intel lockdown: gate legislator stance + rationale behind login
-- ============================================================
-- The anti-weaponization red-team's #1 real-world leak: the
-- legislator_kratom_stance table — our curated champion / sympathetic /
-- neutral / hostile classification PLUS the written rationale_md memo — was
-- world-readable (0112: policy "Public read legislator stance" USING (true)).
-- Any opponent could scrape our entire targeting analysis with ZERO account,
-- straight off the page data / PostgREST API.
--
-- Fix: require authentication to read. Anonymous visitors keep the public
-- legislator directory (name / role / district / contact on `legislators`,
-- unchanged) but never our stance or rationale. Every stance-rendering
-- surface (campaign recipient chips, /states, /bills, /intel/*, briefings,
-- /calls, dashboard) reads through the user's RLS-scoped client, so this one
-- policy locks them all at once; they already degrade gracefully to "no
-- stance shown" on an empty read. The admin write policy from 0112 is
-- unchanged — admins/creators still read + write.
--
-- TIGHTEN LATER (owner's call, one-line change): to ALSO hide stance from
-- regular signed-in advocates — fully protecting the rationale memo from a
-- logged-in opponent who just signs up — swap the USING predicate below to
--   using (public.is_campaign_creator(auth.uid()))
-- Trade-off: advocates lose the stance dots on recipient chips + briefings.
-- (Donor / stock-trade flags are separate PUBLIC-RECORD tables, left public
-- deliberately; gating those is a distinct transparency decision.)
--
-- Rollback: drop this policy; recreate
--   create policy "Public read legislator stance"
--     on public.legislator_kratom_stance for select using (true);
-- ============================================================

drop policy if exists "Public read legislator stance" on public.legislator_kratom_stance;

create policy "Authed read legislator stance"
  on public.legislator_kratom_stance
  for select
  to authenticated
  using (true);
