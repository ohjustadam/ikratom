-- 0143 — Profile field for 7-OH stance preference.
--
-- Owner directive 2026-05-14: 'we should ask the users if they are pro
-- or anti 7oh in their profile but we dont want to customize their feed
-- as to create a divide between the two. the idea is neutrality. so we
-- should use the data to at least update their templates.'
--
-- Adds a single NULLABLE column. NULL = user hasn't declared a position
-- (the default — feed remains neutral). Values:
--   - 'pro'     = user supports continued 7-OH availability with regulation
--   - 'anti'    = user supports restrictions / bans on 7-OH-concentrated products
--   - 'neutral' = user has thought about it and chooses neutrality explicitly
--
-- IMPORTANT: this column is NOT used to filter or rank content on any
-- feed. It is purely an opt-in input that future campaign-template
-- selection logic CAN consult to render a stance-aligned letter draft.
-- Default campaign templates remain neutral regardless.
--
-- Rollback:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS seven_oh_stance;

alter table public.profiles
  add column if not exists seven_oh_stance text;

-- Allow only the three meaningful values + NULL.
do $$
begin
  if not exists (
    select 1 from information_schema.check_constraints
    where constraint_name = 'profiles_seven_oh_stance_check'
  ) then
    alter table public.profiles
      add constraint profiles_seven_oh_stance_check
      check (seven_oh_stance is null or seven_oh_stance in ('pro', 'anti', 'neutral'));
  end if;
end$$;

comment on column public.profiles.seven_oh_stance is
  'Optional user-declared stance on 7-OH-concentrated kratom products. NULL = undeclared (default). Used ONLY for opt-in campaign-template selection; the feed remains neutral regardless of this value. Owner directive 2026-05-14.';
