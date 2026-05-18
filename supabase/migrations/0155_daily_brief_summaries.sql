-- ============================================================
-- 0155_daily_brief_summaries
--
-- Cache table for the AI-generated daily brief paragraph that
-- appears at the top of /brief. One row per (scope, date) where
-- scope is either a 2-letter state abbr or 'national' for anon
-- users. Caps AI-generation cost — at most ~51 LLM calls per day
-- across the entire user base, regardless of how many advocates
-- view the brief.
--
-- The generation is lazy: first user to load /brief for a given
-- scope triggers the LLM call; cached row serves every subsequent
-- view of that scope until midnight UTC.
--
-- v2 idea: per-user customization (mention bills they watch,
-- legislators they track). That needs per-user rows + would scale
-- with active user count. Out of scope for v1.
--
-- Rollback:
--   DROP TABLE IF EXISTS daily_brief_summaries;

create table if not exists public.daily_brief_summaries (
  scope        text not null
    check (scope = 'national' or scope ~ '^[A-Z]{2}$'),
  brief_date   date not null default current_date,
  summary_md   text not null,
  signals_used jsonb,         -- snapshot of the inputs (counts, top bills) for auditability
  provider     text,          -- which AI provider produced it
  generated_at timestamptz not null default now(),
  primary key (scope, brief_date)
);

create index if not exists daily_brief_summaries_recent_idx
  on public.daily_brief_summaries (brief_date desc, scope);

-- Public read: the summary is a public-facing intel paragraph.
alter table public.daily_brief_summaries enable row level security;

drop policy if exists "brief summaries: public read" on public.daily_brief_summaries;
create policy "brief summaries: public read"
  on public.daily_brief_summaries for select
  using (true);

-- Writes are service-role-only (script + server-action via
-- service-role client). No anon insert; no anon update.
