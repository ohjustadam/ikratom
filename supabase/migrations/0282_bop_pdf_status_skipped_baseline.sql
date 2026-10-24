-- 0282_bop_pdf_status_skipped_baseline.sql
--
-- The BoP engine (#1024) records the backlog PDFs on a source's first walk
-- (beyond the first 8, which are parsed) as pdf_status 'skipped_baseline',
-- so they are never parsed or re-inserted as new. The pdf_status check did
-- not allow that value, so the WHOLE first insert of any register page that
-- lists more than 8 PDFs failed (seen on a test walk 2026-10-24, AK Dept of
-- Health), and the source would retry daily, never storing anything.
--
-- Rollback: update public.bop_findings set pdf_status = null where pdf_status = 'skipped_baseline';
--           then re-create the constraint without 'skipped_baseline'.

alter table public.bop_findings drop constraint if exists bop_findings_pdf_status_chk;
alter table public.bop_findings add constraint bop_findings_pdf_status_chk check (
  pdf_status is null or pdf_status = any (array[
    'ok', 'empty', 'too_large', 'fetch_failed', 'parse_failed', 'not_pdf',
    'rejected_unsafe', 'skipped_baseline'
  ])
);
