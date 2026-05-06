-- ============================================================
-- 0031 — Campaign attachments + share-tracking
-- ============================================================
-- Two additions:
--   1) campaign_attachments: video/audio recordings users attach to a
--      legislator email. Stored in a Supabase Storage bucket; this row
--      tracks metadata + transcript + signed URL.
--   2) campaign_shares: count + dedupe outbound shares (FB, X, Reddit,
--      SMS) so the impact dashboard can show "X shared, Y emailed,
--      Z called."
--
-- The attachment file lives in Supabase Storage (bucket created by this
-- migration); we never put binary in the DB.
-- ============================================================

create table if not exists public.campaign_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('audio','video')),
  storage_path text not null,
  duration_seconds integer,
  size_bytes integer,
  /** Browser-side Web Speech API output, optional. Helps deliverability +
      legislator staff who can't watch a video can read it instead. */
  transcript text,
  /** Soft-delete: user can withdraw an attachment they regret submitting. */
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists campaign_attachments_user_idx
  on public.campaign_attachments (user_id, created_at desc);

alter table public.campaign_attachments enable row level security;

drop policy if exists "attachments_self_all" on public.campaign_attachments;
create policy "attachments_self_all" on public.campaign_attachments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "attachments_admin_read" on public.campaign_attachments;
create policy "attachments_admin_read" on public.campaign_attachments
  for select using (public.is_admin(auth.uid()));

-- ── Outbound share tracking ─────────────────────────────────
-- A row per click of a share-to-X button. Anonymous clicks (not signed
-- in) get user_id = null; that's fine — we still want the count for
-- impact stats. RLS keeps reads to admins so the per-user trail stays
-- private.
create table if not exists public.campaign_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  bill_id uuid references public.bills(id) on delete cascade,
  story_id uuid references public.kratom_stories(id) on delete cascade,
  platform text not null check (platform in ('facebook','x','reddit','sms','threads','copy_link')),
  created_at timestamptz not null default now(),
  -- exactly one target type set
  check (
    (campaign_id is not null)::int +
    (bill_id is not null)::int +
    (story_id is not null)::int = 1
  )
);

create index if not exists campaign_shares_platform_idx
  on public.campaign_shares (platform, created_at desc);
create index if not exists campaign_shares_campaign_idx
  on public.campaign_shares (campaign_id) where campaign_id is not null;

alter table public.campaign_shares enable row level security;

-- Anyone can insert (we want anon shares counted)
drop policy if exists "shares_public_insert" on public.campaign_shares;
create policy "shares_public_insert" on public.campaign_shares
  for insert with check (true);

-- Reads: admins only
drop policy if exists "shares_admin_read" on public.campaign_shares;
create policy "shares_admin_read" on public.campaign_shares
  for select using (public.is_admin(auth.uid()));

-- ── Storage bucket for attachments ──────────────────────────
-- Public bucket so the unguessable signed-URL is enough to share via
-- email. Per-user RLS on the storage.objects table restricts uploads.
insert into storage.buckets (id, name, public)
  values ('campaign-attachments', 'campaign-attachments', true)
  on conflict (id) do nothing;

-- Storage RLS: users can upload + read + delete their own files
drop policy if exists "attach_owner_insert" on storage.objects;
create policy "attach_owner_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'campaign-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attach_owner_select" on storage.objects;
create policy "attach_owner_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'campaign-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "attach_owner_delete" on storage.objects;
create policy "attach_owner_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'campaign-attachments' and auth.uid()::text = (storage.foldername(name))[1]);

-- Public read for everyone (bucket is public; URLs are unguessable UUIDs)
drop policy if exists "attach_public_read" on storage.objects;
create policy "attach_public_read" on storage.objects
  for select to anon
  using (bucket_id = 'campaign-attachments');
