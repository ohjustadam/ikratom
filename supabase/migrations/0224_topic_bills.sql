-- ============================================================
-- 0224 — topic_bills: discovered non-kratom substance-policy bills (phase 2)
-- ============================================================
-- Discovered bills for the non-kratom topics (cannabis, hemp_cbd, psychedelics,
-- supplements, tobacco_vaping, alcohol) via LegiScan getSearch.
--
-- Kept DELIBERATELY SEPARATE from public.bills: ~56 code sites query `bills`
-- without a topic filter, so putting non-kratom bills there would pollute every
-- kratom surface (legislator sponsored-bills, /bills, /banned, intel, etc.).
-- A separate table means those surfaces NEVER see these rows — kratom UX stays
-- clean BY CONSTRUCTION, no 56-file change. The /topics explorer unions this
-- table (non-kratom) with bills.bill_topics (cross-topic kratom bills).
--
-- One row per (legiscan_bill_id, topic): a bill matching two topics = two rows.
-- These are tracking records (search metadata), not the full kratom dossier
-- (no sponsors/votes machinery, which keys off bills.id) — that's a later step.
--
-- Rollback: drop table public.topic_bills;

create table if not exists public.topic_bills (
  legiscan_bill_id integer not null,
  topic            text not null,
  state            text not null,
  bill_number      text not null,
  title            text,
  stance           text,            -- restrictive | permissive | mixed | unknown (nonpartisan direction)
  relevance        integer,         -- LegiScan search relevance 0-100
  last_action      text,
  last_action_date date,
  url              text,
  change_hash      text,
  discovered_at    timestamptz not null default now(),
  primary key (legiscan_bill_id, topic)
);

create index if not exists ix_topic_bills_topic on public.topic_bills (topic, last_action_date desc nulls last);

alter table public.topic_bills enable row level security;
-- Public read (public legislative data; mirrors bills' public read for /topics).
drop policy if exists "Public read topic_bills" on public.topic_bills;
create policy "Public read topic_bills" on public.topic_bills for select using (true);
-- No write policy → only the service role (discovery script/cron) can write.

comment on table public.topic_bills is
  'Discovered non-kratom substance-policy bills (LegiScan getSearch), kept separate from public.bills so kratom surfaces stay clean. PK (legiscan_bill_id, topic). Populated by scripts/discover-topic-bills.mjs; surfaced in /topics.';
