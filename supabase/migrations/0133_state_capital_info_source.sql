-- 0133 — Add `last_updated_source` text marker to state_capital_info.
--
-- Original schema (migration that created state_capital_info) used
-- `last_updated_by uuid REFERENCES auth.users(id)` for "which admin
-- hand-curated this row." That makes sense for the NY hand-curated
-- entry. But it doesn't accommodate the AI-seeder pattern (no user
-- ID maps to "AI"), and we want admins to immediately spot which
-- rows are AI-drafted vs hand-curated so the AI ones can be reviewed
-- or upgraded over time.
--
-- Solution: a separate text column for the source. last_updated_by
-- stays for the actual admin UUID when relevant; last_updated_source
-- captures 'hand' | 'ai-seeder' | future flavors.
--
-- Rollback:
--   ALTER TABLE public.state_capital_info DROP COLUMN IF EXISTS last_updated_source;

ALTER TABLE public.state_capital_info
  ADD COLUMN IF NOT EXISTS last_updated_source text;

-- Stamp NY's existing row as hand-curated so the admin index is correct
-- immediately. Skips other rows because they don't exist yet.
UPDATE public.state_capital_info
SET last_updated_source = 'hand'
WHERE state = 'NY' AND last_updated_source IS NULL;

COMMENT ON COLUMN public.state_capital_info.last_updated_source IS
  'How the row was last updated: ''hand'' (admin), ''ai-seeder'' (scripts/seed-state-capital-info.mjs), or future automation flavors. Pair with last_updated_by for the admin UUID when applicable.';
