-- ============================================================
-- 0033 — Seed 'US' jurisdiction for federal bills
-- ============================================================
-- bills.state is FK to states.abbr. Federal bills need a row to point at.
-- We use 'US' (2 chars to fit existing varchar/text constraints) so federal
-- bills with scope='federal' coexist with state bills cleanly.
-- ============================================================

insert into public.states (abbr, name)
  values ('US', 'United States (Federal)')
  on conflict (abbr) do nothing;
