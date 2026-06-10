-- 0195_dossiers.sql — the Dossier table (flagship Phase 1).
--
-- One row per research target (org / official / state): a deep-dive
-- intelligence brief written nightly by the LOCAL Hermes agent
-- (scripts/dossier-research.mjs) from the platform's own verified corpora —
-- orgs roster, donations, lobbying filings, bills, local bans, research
-- papers, meetings. The agent works ONLY from tool results; every dossier
-- carries its source list.
--
-- PUBLICATION DISCIPLINE: dossiers are ADMIN-ONLY until a human review gate
-- exists (the owner's two-source rule applies to every PUBLISHED dossier
-- claim — the 2026-06-09 wrong-government incidents are the cautionary
-- tale). Public /dossier pages come in a later phase WITH that gate.
--
-- Rollback: drop table public.dossiers;

create table if not exists public.dossiers (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null check (target_kind in ('org','official','state')),
  target_key text not null,        -- policy_orgs.slug / legislators.id / state code
  target_name text not null,
  state text check (state is null or state ~ '^[A-Z]{2}$'),

  summary text,                    -- 2-3 line tl;dr
  body_md text,                    -- the dossier (markdown, sectioned)
  sources_md text,                 -- which tools/rows the agent drew from

  model text,                      -- e.g. hermes3:8b
  tool_calls int not null default 0,
  generated_at timestamptz not null default now(),
  refreshed_at timestamptz,

  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,

  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (target_kind, target_key)
);

comment on table public.dossiers is
  'Hermes-written deep-dive briefs per target (org/official/state). ADMIN-ONLY until the human review gate ships — two-source discipline applies to anything published.';

create index if not exists dossiers_kind_idx on public.dossiers (target_kind, active);
create index if not exists dossiers_refresh_idx on public.dossiers (refreshed_at nulls first);

alter table public.dossiers enable row level security;

drop policy if exists "Admins read dossiers" on public.dossiers;
create policy "Admins read dossiers"
  on public.dossiers for select
  using (public.is_admin(auth.uid()));
-- writes: service role only (the nightly agent)
