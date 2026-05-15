-- 0145 — Storage bucket for leader-submitted research PDFs.
--
-- Owner directive 2026-05-15: 'on the /research/submit page there should
-- be a way to upload files directly if they have the pdf or another
-- version of it.'
--
-- Free-tier strategy: Supabase Storage gives 1GB at no cost. With a 10MB
-- per-file cap (research PDFs are typically 2-5MB), we can hold ~200 docs
-- before we'd need to upgrade — plenty of runway for the leader-curated
-- model where each upload is hand-reviewed before going live.
--
-- Bucket name: `research-uploads`
-- Path convention: `{user_id}/{paper_id}/{filename}` so RLS can scope
--   writes to "own folder" and reads stay scoped per paper.
-- Privacy: bucket is PRIVATE (not public). Reads happen via signed URLs
--   issued at render time on /research/[id]. This lets us audit usage +
--   revoke if a paper gets retracted or pulled.
-- Lifecycle: when a paper row is deleted, the storage cleanup runs via
--   a separate cron pass (deferred — not load-bearing).
--
-- Rollback:
--   delete from storage.buckets where id = 'research-uploads';
--   (any objects auto-delete via cascade)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'research-uploads',
  'research-uploads',
  false,  -- private; signed URLs only
  10 * 1024 * 1024,  -- 10MB per file
  array['application/pdf', 'text/plain', 'text/markdown']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS policies for the bucket
-- INSERT: authenticated users can write to their own folder. We trust
-- the user_id prefix in the path because the storage URL flow is
-- gated by auth.uid() at request time.
drop policy if exists "research-uploads_insert_own" on storage.objects;
create policy "research-uploads_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'research-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: admin only via service role. Public users get signed URLs from
-- the server-rendered /research/[id] page — no direct storage reads.
drop policy if exists "research-uploads_read_admin" on storage.objects;
create policy "research-uploads_read_admin" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'research-uploads'
    and public.is_admin(auth.uid())
  );

-- DELETE: own folder (so a leader can withdraw their own submission
-- before admin approval) OR admin (retract anything).
drop policy if exists "research-uploads_delete_own_or_admin" on storage.objects;
create policy "research-uploads_delete_own_or_admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'research-uploads'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin(auth.uid())
    )
  );

-- Add pdf_url + uploaded_storage_path to research_papers so we can
-- link an uploaded file to a paper row + revoke it if needed.
-- pdf_url already exists from migration 0116; we just add the storage-
-- path mirror so admin can clean up storage when a row is deactivated.
alter table public.research_papers
  add column if not exists uploaded_storage_path text;

comment on column public.research_papers.uploaded_storage_path is
  '0145: when set, points to the file under storage bucket "research-uploads". Used to issue signed URLs and to clean up storage on row deletion. pdf_url remains the canonical public URL field (may be set without uploaded_storage_path when the PDF is hosted externally).';
