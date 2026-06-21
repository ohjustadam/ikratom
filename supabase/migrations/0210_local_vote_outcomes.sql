-- ============================================================
-- 0210_local_vote_outcomes
--
-- Calendar-completeness: a structured record of PAST local (city/county) votes
-- on kratom — bans/regulations passed, failed, or tabled by councils &
-- commissions. The narrative already arrives as policy_alerts ("Spokane City
-- Council votes to ban…"), but those are filtered off the forward calendar
-- (occurs_at >= now) and aren't queryable as outcomes. This flat,
-- CSV-exportable table restructures them into real outcome rows (populated by
-- scripts/extract-local-vote-outcomes.mjs from the source alerts — real data,
-- never fabricated) so /calendar history + future intel surfaces can show
-- "who banned / who protected kratom" with a pass/fail badge.
--
-- Rollback: DROP TABLE public.local_vote_outcomes;
-- ============================================================

create table if not exists public.local_vote_outcomes (
  id              uuid primary key default gen_random_uuid(),
  state           text,                 -- 2-letter, nullable when unknown
  locality        text not null,        -- city / county name (the local body)
  vote_date       date not null,
  outcome         text not null,        -- 'passed' | 'failed' | 'tabled'
  measure         text not null,        -- short description of what was voted on
  description     text,
  source_url      text,
  policy_alert_id uuid references public.policy_alerts(id) on delete set null,
  created_at      timestamptz not null default now()
);

-- One outcome row per source alert → the populate script is idempotent.
create unique index if not exists local_vote_outcomes_alert_uniq
  on public.local_vote_outcomes (policy_alert_id) where policy_alert_id is not null;
create index if not exists local_vote_outcomes_date_idx
  on public.local_vote_outcomes (vote_date desc);
create index if not exists local_vote_outcomes_state_idx
  on public.local_vote_outcomes (state) where state is not null;

alter table public.local_vote_outcomes enable row level security;

-- Public record — anyone can read; only admins write (the populate script uses
-- the service-role key, which bypasses RLS).
create policy local_vote_outcomes_public_read on public.local_vote_outcomes
  for select using (true);
create policy local_vote_outcomes_admin_all on public.local_vote_outcomes
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
