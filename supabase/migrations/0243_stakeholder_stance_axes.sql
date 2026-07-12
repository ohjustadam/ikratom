-- 0243 — Two-axis stance for bill_stakeholders (strictly neutral tracker).
--
-- Owner directive 2026-07-11: the platform must be a STRICTLY NEUTRAL stance
-- TRACKER for people/figures — NEVER a global "ally"/"opponent" value label.
-- Instead, show each figure's documented position as FACTS on two INDEPENDENT
-- axes, each with evidence:
--   • natural leaf (the whole plant)
--   • 7-OH (concentrated 7-hydroxymitragynine) — a separate regulatory axis
--
-- This mirrors the two-dimensional model the platform already uses for bills
-- (bills.substance_targeting, 0063) and users (profiles.seven_oh_stance, 0143;
-- "the idea is neutrality"). The flat role_type ally/opponent (0139) collapsed
-- both axes into one tribal label and MISLABELED figures who back the leaf but
-- split on 7-OH — e.g. 7-HOPE Alliance (pro-7-OH AND pro-whole-plant) and the
-- AKA (pro-leaf, anti-concentrated-7-OH) were BOTH tagged "opponent", for
-- opposite reasons. Vocabulary here is deliberately descriptive (supportive /
-- restrictive / neutral), not pro/anti, to keep the surface non-partisan.
--
-- NULL on either axis = not yet researched (or not applicable). The UI renders
-- NULL as "not documented", never as a stance.
--
-- Rollback:
--   alter table public.bill_stakeholders
--     drop column if exists leaf_stance,
--     drop column if exists seven_oh_stance,
--     drop column if exists leaf_evidence_url,
--     drop column if exists seven_oh_evidence_url,
--     drop column if exists stance_summary,
--     drop column if exists stance_source,
--     drop column if exists stance_researched_at;

alter table public.bill_stakeholders
  add column if not exists leaf_stance text
    check (leaf_stance is null or leaf_stance in ('supportive','restrictive','neutral')),
  add column if not exists seven_oh_stance text
    check (seven_oh_stance is null or seven_oh_stance in ('supportive','restrictive','neutral')),
  add column if not exists leaf_evidence_url text,
  add column if not exists seven_oh_evidence_url text,
  add column if not exists stance_summary text,       -- 1-2 sentence sourced, neutral summary
  add column if not exists stance_source text,         -- provenance: 'ai-research-v1' | 'admin' | ...
  add column if not exists stance_researched_at timestamptz;

comment on column public.bill_stakeholders.leaf_stance is
  'Documented position on NATURAL LEAF kratom (the plant): supportive (backs legal access) | restrictive (backs bans/restrictions) | neutral. NULL = not yet researched. Neutral factual axis — NOT a tribal ally/opponent label. Owner directive 2026-07-11.';
comment on column public.bill_stakeholders.seven_oh_stance is
  'Documented position on concentrated 7-OH (7-hydroxymitragynine) products — a SEPARATE axis from the leaf: supportive | restrictive | neutral. NULL = not researched / not applicable.';
comment on column public.bill_stakeholders.stance_summary is
  'Short neutral, sourced summary of the figure''s documented position(s). Rendered as fact, not framing.';
