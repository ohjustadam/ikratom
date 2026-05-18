-- ============================================================
-- 0154_bill_research_alignment
--
-- The cross-reference layer. Links every bill to the research
-- papers in our library that are relevant to it, scored + tagged
-- with alignment direction (aligned / contradictory / context).
--
-- This is the connective tissue the "smart kratom brain" was
-- missing — papers existed as an island, bills existed as an
-- island, no way to ask "what does science say about this bill?"
--
-- Populated by scripts/align-bills-to-research.mjs which runs on
-- the daily cron. Algorithm v1:
--   1. CLUSTER MAPPING — bills in detected coordinated operations
--      inherit topic-relevance from a known cluster→topic map.
--      KCPA → natural-leaf safety + contamination + age. Schedule-I
--      → harm assessment + opioid-comparison. Etc.
--   2. TOPIC KEYWORD overlap on uncluster bills.
--   3. ALIGNMENT direction is heuristic: paper supports vs refutes
--      the bill's stated kratom_relevance based on AI findings.
--
-- v2 (when funded): per-bill embedding similarity to paper
-- abstracts, with an LLM-judge confirmation pass.
--
-- Rollback:
--   DROP TABLE IF EXISTS bill_research_alignment;

create table if not exists public.bill_research_alignment (
  id uuid primary key default gen_random_uuid(),
  bill_id  uuid not null references public.bills(id) on delete cascade,
  paper_id uuid not null references public.research_papers(id) on delete cascade,
  -- 0.0 → 1.0 relevance score (1.0 = directly addresses the bill's premise)
  relevance_score real not null check (relevance_score between 0 and 1),
  -- Human-readable reasoning so admins can audit + tune the script
  match_reason text not null,
  -- Direction relative to the bill's posture
  alignment text not null check (alignment in ('aligned', 'contradictory', 'context')),
  -- How this row was generated: drives admin filters + future
  -- re-scoring passes that can selectively overwrite by source
  source text not null check (source in ('cluster_mapping', 'topic_keyword', 'embedding', 'manual')),
  -- Optional admin override note (e.g. "this match is wrong because…")
  admin_override_note text,
  created_at timestamptz not null default now(),
  -- One row per (bill, paper) pair — re-runs of the script UPSERT
  -- and overwrite the score + reason without spawning duplicates.
  unique (bill_id, paper_id)
);

-- Hot path: per-bill page renders top-N papers ordered by score.
create index if not exists bill_research_alignment_bill_score_idx
  on public.bill_research_alignment (bill_id, relevance_score desc);
-- Reverse direction: per-paper page (future) — which bills cite this study.
create index if not exists bill_research_alignment_paper_idx
  on public.bill_research_alignment (paper_id);
-- Admin: find recent imports + audit by source.
create index if not exists bill_research_alignment_recent_idx
  on public.bill_research_alignment (created_at desc);

-- RLS: public read (both bills and research are public-facing data).
-- Only the service role writes (the alignment script + admin overrides).
alter table public.bill_research_alignment enable row level security;

drop policy if exists "alignment: public read" on public.bill_research_alignment;
create policy "alignment: public read"
  on public.bill_research_alignment for select
  using (true);

-- (No insert/update/delete policies → effectively service-role-only
-- writes. Admin UI for manual overrides can go through a server
-- action that uses the service-role client.)
