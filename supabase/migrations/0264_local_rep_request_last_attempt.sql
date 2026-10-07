-- 0264_local_rep_request_last_attempt.sql — record WHY the batch couldn't
-- resolve a pending local-rep request.
--
-- Background (2026-10-07, Elk Grove, CA): the cloud batch tried the request,
-- hit a city site behind a Cloudflare bot check, logged `no-extract`, and left
-- it pending. The admin page only ever said "queued for the next batch — check
-- back shortly", so the request looked like it was progressing when it never
-- could. The batch now writes its outcome here and /admin/local-rep-requests
-- shows it on the row, with a hand-add link when a human has to step in.
--
-- Flat columns, written only by the batch (service role). Existing row-level
-- policies already cover reads (self + admin); no new policy needed.
--
-- Rollback:
--   alter table public.local_rep_requests
--     drop column if exists last_attempt_at,
--     drop column if exists last_attempt_reason,
--     drop column if exists last_attempt_detail;

alter table public.local_rep_requests
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_attempt_reason text
    check (last_attempt_reason is null or length(last_attempt_reason) <= 40),
  add column if not exists last_attempt_detail text
    check (last_attempt_detail is null or length(last_attempt_detail) <= 200);

comment on column public.local_rep_requests.last_attempt_reason is
  'Batch outcome code from findAndExtractOfficials: site-blocked | no-extract | no-gov-candidate | searxng-empty | no-officials. Rendered by src/lib/local-rep-attempt.ts.';
comment on column public.local_rep_requests.last_attempt_detail is
  'Short context for the reason, usually the hostname that was tried.';
