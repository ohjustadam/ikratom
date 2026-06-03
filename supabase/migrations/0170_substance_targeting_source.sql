-- ============================================================
-- 0170_substance_targeting_source
--
-- Adds provenance to bills.substance_targeting.
--
-- Two scripts now write the per-substance targeting map:
--   1. enrich-bill-journey.mjs  — writes it as a side effect of the
--      4-paragraph journey/PDF pass (OpenStates fetch). 7-OH signal
--      there is weak: most seven_oh entries land "unaddressed"/"neutral"
--      with confidence 0 (it isn't the focus of that prompt).
--   2. classify-bill-substance.mjs (NEW, State Mission Control PR1) —
--      a DEDICATED substance/7-OH classifier that reads already-stored
--      bill text (bill_text_versions / summary_long / summary) and
--      routes through the free-tier AI router. No OpenStates fetch.
--
-- This column records which pass last wrote substance_targeting so:
--   - the dedicated classifier can be idempotent (skip rows it already
--     owns; --refresh re-does them),
--   - the PR3 reconciliation layer can trust dedicated-pass rows over
--     journey side-effect rows when deriving state_status.
--
-- Values: 'ai-substance-pass-v1' (dedicated classifier) |
--          'journey' (enrich-bill-journey side effect) | null (legacy).
--
-- Additive + nullable — no backfill, no rollback needed (drop column).
-- ============================================================

alter table public.bills
  add column if not exists substance_targeting_source text;

comment on column public.bills.substance_targeting_source is
  'Which pass last wrote substance_targeting: ai-substance-pass-v1 (classify-bill-substance.mjs, dedicated) | journey (enrich-bill-journey.mjs side effect) | null (legacy). Used for idempotency + reconciliation provenance.';
