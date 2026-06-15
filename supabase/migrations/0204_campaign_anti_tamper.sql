-- ============================================================
-- 0204 — Campaign anti-tamper: ownership, version history, wave snapshots
-- ============================================================
-- Closes three tamper vectors found in the anti-weaponization red-team.
-- These are load-bearing for content screening (a later PR): screening a
-- template at authorship is meaningless if it can be swapped afterward.
--
--   1. ANY campaign creator could silently edit ANY other creator's live
--      campaign — campaigns_creator_write was a pure role check with no
--      ownership. → add campaigns.created_by + scope leader writes to their
--      own rows; admins/owner keep full access (is_admin() covers owner).
--
--   2. Template swaps left no trace: the audit log recorded "updated" but
--      never the template text, so swap-then-revert was unreconstructable.
--      → append-only campaign_template_versions records every template
--      state with who/when. No update/delete policy → immutable.
--
--   3. A wave re-read the LIVE campaign template at fire time, so a leader
--      could get clean text approved, let users join, then swap to hostile
--      text before fire — joiners sent text they never saw. → snapshot the
--      template + target list onto the wave at creation; fire renders from
--      the snapshot, falling back to live only for pre-migration waves.
--
-- Rollback: drop column campaigns.created_by; drop table
-- campaign_template_versions; drop the *_snapshot columns on
-- campaign_waves; recreate the old role-only campaigns_creator_write
-- policy. No data loss for existing campaigns or waves.
-- ============================================================

-- ── 1. Campaign ownership ───────────────────────────────────
alter table public.campaigns
  add column if not exists created_by uuid references auth.users(id) on delete set null;

-- Backfill legacy rows to the owner so they stay editable (by owner/admins)
-- and don't become orphaned/uneditable under the new ownership rule.
update public.campaigns c
set created_by = (select id from public.profiles where is_owner = true limit 1)
where c.created_by is null;

create index if not exists campaigns_created_by_idx on public.campaigns (created_by);

-- Ownership-scoped write: admins/owner edit ANY campaign; an advocate
-- leader may write only campaigns they created. Public read is unchanged.
drop policy if exists "campaigns_creator_write" on public.campaigns;
create policy "campaigns_creator_write" on public.campaigns
  for all
  using (
    public.is_admin(auth.uid())
    or (public.is_campaign_creator(auth.uid()) and created_by = auth.uid())
  )
  with check (
    public.is_admin(auth.uid())
    or (public.is_campaign_creator(auth.uid()) and created_by = auth.uid())
  );

-- ── 2. Append-only template version history ─────────────────
create table if not exists public.campaign_template_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  subject_template text,
  body_template text,
  edited_by uuid references auth.users(id) on delete set null,
  edited_at timestamptz not null default now()
);

create index if not exists campaign_template_versions_campaign_idx
  on public.campaign_template_versions (campaign_id, edited_at desc);

alter table public.campaign_template_versions enable row level security;

-- Read: any campaign creator (admin/owner/leader) — it's an audit trail;
-- transparency across the trusted creator tier helps catch tampering.
drop policy if exists "campaign_template_versions_creator_read" on public.campaign_template_versions;
create policy "campaign_template_versions_creator_read" on public.campaign_template_versions
  for select using (public.is_campaign_creator(auth.uid()));

-- Insert: a creator may only stamp a version as themselves. No update/
-- delete policy is defined → rows are append-only / immutable.
drop policy if exists "campaign_template_versions_creator_insert" on public.campaign_template_versions;
create policy "campaign_template_versions_creator_insert" on public.campaign_template_versions
  for insert with check (
    public.is_campaign_creator(auth.uid()) and edited_by = auth.uid()
  );

-- ── 3. Wave template + target snapshot ──────────────────────
-- Frozen at wave creation; fire.ts renders from these, falling back to the
-- live campaign only for waves created before this migration (NULL columns).
alter table public.campaign_waves
  add column if not exists subject_template_snapshot text,
  add column if not exists body_template_snapshot text,
  add column if not exists target_legislator_ids_snapshot uuid[],
  add column if not exists target_roles_snapshot text[];
