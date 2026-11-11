-- 0320_feedback_replies.sql
--
-- Owner ask 2026-11-10: "I need a way to reply to feedback within the site.
-- I can view them and get notifications. I just can't respond."
--
-- feedback_replies holds every reply an admin sends from /admin/feedback:
-- who wrote it, when, the text, and how it went out.
--   channel 'site'  = a signed-in reporter: an in-site notification (and push
--                     or the email digest when they opted in to those).
--   channel 'email' = an anonymous reporter who left an address: one platform
--                     email from the role address, Reply-To support@.
-- Rows are written by the reply server action with the service role, after
-- getAdminContext(). Admins read the thread through the policy below.
-- Reporters read their own replies through listMyFeedback(), which checks the
-- signed-in user and selects only the text and date, never the author.
--
-- feedback_reports.contact_email is the optional address an anonymous visitor
-- leaves in the feedback widget so we can answer. Signed-in members never
-- need one: they are reached on the site.
--
-- Grants are explicit: new public tables get none by default since 2026-10-30.
--
-- Rollback:
--   drop table if exists public.feedback_replies;
--   alter table public.feedback_reports drop column if exists contact_email;

alter table public.feedback_reports
  add column if not exists contact_email text
  check (
    contact_email is null
    or (char_length(contact_email) <= 254
        and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  );

create table if not exists public.feedback_replies (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.feedback_reports(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  channel text not null check (channel in ('site', 'email')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  detail text check (detail is null or char_length(detail) <= 300),
  sent_to text check (sent_to is null or char_length(sent_to) <= 254),
  created_at timestamptz not null default now()
);

create index if not exists feedback_replies_report_idx
  on public.feedback_replies (report_id, created_at);

alter table public.feedback_replies enable row level security;

drop policy if exists "feedback_replies: admin read" on public.feedback_replies;
create policy "feedback_replies: admin read"
  on public.feedback_replies for select
  to authenticated
  using (public.is_admin(auth.uid()));

revoke all on public.feedback_replies from anon, authenticated;
grant select on public.feedback_replies to authenticated;
grant select, insert, update, delete on public.feedback_replies to service_role;
