-- 0141 — Banned-state takeback intel columns on bills.
--
-- Owner directive: 'we need info on the banned states as well as
-- what forces pushed against kratom and where that political trail
-- leads and where that money comes from and who those anti kratom
-- advocates are and who their organization is. ... a plan to take
-- back states that have been banned. action plans. who to contact.'
--
-- Two new columns on bills to hold this content (editorial markdown):
--   - opposition_summary_md: who pushed for the ban, what advocates
--     supported them, what funding sources backed it. The "money +
--     political trail" the directive asked about.
--   - repeal_plan_md: concrete repeal action plan — current
--     legislators most likely to support repeal, talking points,
--     local advocates to coordinate with, public-health data that
--     refutes the ban's premise, sequence of moves.
--
-- These fields are NULLABLE — only enacted-ban bills meaningfully
-- need them. Editorial admin populates per state.
--
-- Rendering: bill detail page surfaces these as separate sections
-- when present. /banned page also links into each banned state's
-- bill page for the full plan.
--
-- Rollback:
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS opposition_summary_md;
--   ALTER TABLE public.bills DROP COLUMN IF EXISTS repeal_plan_md;

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS opposition_summary_md text,
  ADD COLUMN IF NOT EXISTS repeal_plan_md text;

COMMENT ON COLUMN public.bills.opposition_summary_md IS
  'Editorial markdown describing who pushed the ban: sponsor + supporting advocates + funding sources + political coalition. Populated for enacted-ban bills as part of the banned-state takeback intel framework.';
COMMENT ON COLUMN public.bills.repeal_plan_md IS
  'Editorial markdown describing the concrete repeal action plan: which current legislators to target, talking points, local advocates to coordinate with, public-health data that refutes the ban premise, sequencing of moves.';
