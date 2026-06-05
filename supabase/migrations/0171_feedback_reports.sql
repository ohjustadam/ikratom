-- 0171_feedback_reports.sql
-- Floating feedback / error-report widget (owner priority).
--
-- Users on any page can submit free-text feedback + an optional screenshot
-- via the right-edge FeedbackWidget. Reports land here; admins triage at
-- /admin/feedback. Screenshots live in a PRIVATE Storage bucket — all
-- screenshot I/O is server-side (service-role mints signed upload URLs for
-- clients and signed read URLs for admins), so no client storage policies
-- are needed.
--
-- Rollback:
--   drop table if exists public.feedback_reports;
--   delete from storage.buckets where id = 'feedback-screenshots';

create table if not exists public.feedback_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,   -- null = anonymous submitter
  message text not null check (char_length(message) between 1 and 5000),
  page_url text check (page_url is null or char_length(page_url) <= 1000),
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  screenshot_path text check (screenshot_path is null or char_length(screenshot_path) <= 400),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_reports_status_created
  on public.feedback_reports (status, created_at desc);

alter table public.feedback_reports enable row level security;

-- Inserts happen server-side via service-role (the submit action), so there
-- is intentionally NO client INSERT policy. Admins read + update status.
drop policy if exists "feedback_reports: admin read" on public.feedback_reports;
create policy "feedback_reports: admin read"
  on public.feedback_reports for select
  using (public.is_admin(auth.uid()));

drop policy if exists "feedback_reports: admin update" on public.feedback_reports;
create policy "feedback_reports: admin update"
  on public.feedback_reports for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Private screenshot bucket (5 MB cap, images only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-screenshots',
  'feedback-screenshots',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
