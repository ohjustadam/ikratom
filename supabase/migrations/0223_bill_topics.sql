-- ============================================================
-- 0223 — bill_topics: multi-topic tagging foundation (phase 1)
-- ============================================================
-- Generalize bill tracking beyond kratom. Additive jsonb recording which
-- substance-policy topics each bill touches + a coarse regulatory direction,
-- keyed by the canonical STANCE_TOPICS (kratom, cannabis, hemp_cbd,
-- psychedelics, supplements, tobacco_vaping, alcohol).
--
-- PHASE 1 = FOUNDATION ONLY. Nothing reads bill_topics yet, and the existing
-- kratom_relevance column + every kratom surface are untouched — so there is
-- ZERO behavior change. This is intentionally additive to avoid colliding with
-- the active bill-status + sponsor-resolution sessions. Phase 2 (discovering
-- non-kratom bills + making the app topic-aware) is a separate cross-cutting
-- effort that must follow those sessions.
--
-- Shape: { "<topic>": { "stance": "restrictive"|"permissive"|"mixed"|"unknown",
--                       "confidence": 0..1, "method": "keyword"|"ai",
--                       "matched": ["marijuana", ...], "at": "<iso>" } }
--
-- Rollback:
--   alter table public.bills drop column if exists bill_topics;
--   alter table public.bills drop column if exists bill_topics_classified_at;

alter table public.bills add column if not exists bill_topics jsonb;
alter table public.bills add column if not exists bill_topics_classified_at timestamptz;

create index if not exists ix_bills_topics on public.bills using gin (bill_topics jsonb_path_ops);

comment on column public.bills.bill_topics is
  'Multi-topic tags { topic: { stance, confidence, method, matched, at } } keyed by STANCE_TOPICS. Additive to kratom_relevance (which remains the kratom-primary signal). Phase 1 foundation; populated by scripts/classify-bill-topics.mjs.';
