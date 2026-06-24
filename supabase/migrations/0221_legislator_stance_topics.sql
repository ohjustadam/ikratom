-- ============================================================
-- 0221 — Topic-keyed legislator stance (generalize kratom -> multi-issue)
-- ============================================================
-- The Officials-Intelligence vision: track each official's stance across many
-- issues, not just kratom (cannabis, hemp/CBD, psychedelics, dietary
-- supplements, tobacco/vaping, alcohol). legislator_kratom_stance was 1 row
-- per legislator; we generalize to 1 row per (legislator, topic).
--
-- EXPAND-CONTRACT (safe for the live feature): create a NEW table, copy the
-- existing kratom rows in as topic='kratom', and repoint all code (this PR) to
-- the new table with an explicit topic filter (default 'kratom' == identical
-- behavior). The OLD legislator_kratom_stance table is intentionally LEFT IN
-- PLACE so there is zero broken window during the deploy (old code keeps
-- reading the old table until the new deploy is live). A follow-up migration
-- drops legislator_kratom_stance once this is confirmed stable in prod.
--
-- FK to legislators is kept so PostgREST embeds (legislators!inner) resolve
-- exactly as before (/calls, generate-state-briefing). RLS mirrors the old
-- table post-0208: admin write; read = verified-tier OR campaign-creator.
--
-- Rollback: drop table public.legislator_stance;  (old table still intact)

create table if not exists public.legislator_stance (
  legislator_id   uuid not null references public.legislators(id) on delete cascade,
  topic           text not null default 'kratom',
  stance          text not null check (stance in ('champion','sympathetic','neutral','hostile','unknown')),
  rationale_md    text,
  last_evidence_url text,
  last_updated_at timestamptz not null default now(),
  last_updated_by uuid references auth.users(id) on delete set null,
  primary key (legislator_id, topic)
);

-- Seed the kratom topic from the existing table (idempotent re-run safe).
insert into public.legislator_stance
  (legislator_id, topic, stance, rationale_md, last_evidence_url, last_updated_at, last_updated_by)
select legislator_id, 'kratom', stance, rationale_md, last_evidence_url, last_updated_at, last_updated_by
from public.legislator_kratom_stance
on conflict (legislator_id, topic) do nothing;

-- Reads commonly scan "all stances for a topic" (then map by legislator_id),
-- so index the topic.
create index if not exists legislator_stance_topic_idx on public.legislator_stance (topic);

alter table public.legislator_stance enable row level security;

-- read: verified tier or campaign creator (mirrors 0208 lockdown on old table)
drop policy if exists "Verified read legislator_stance" on public.legislator_stance;
create policy "Verified read legislator_stance"
  on public.legislator_stance
  for select
  to authenticated
  using (public.is_campaign_creator(auth.uid()) or public.is_verified(auth.uid()));

-- write: admin only
drop policy if exists "Admin write legislator_stance" on public.legislator_stance;
create policy "Admin write legislator_stance"
  on public.legislator_stance
  for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.legislator_stance is
  'Topic-keyed per-legislator stance (champion/sympathetic/neutral/hostile/unknown) with rationale + evidence. Generalizes legislator_kratom_stance (which is deprecated; topic=''kratom'' rows copied here). Topics: kratom, cannabis, hemp_cbd, psychedelics, supplements, tobacco_vaping, alcohol.';
