-- ============================================================
-- 0099_bop_pdf_parsing
--
-- The regex classifier only reads link text. Most state BoP agendas
-- link to a PDF packet whose title is generic ("January 2026 Meeting
-- Materials") but whose contents contain the actual rule-proposal
-- text ("Petition to add mitragynine to Schedule I"). Those PDF-only
-- kratom rules currently never reach the AI classifier because the
-- regex pass marks the link 'unrelated' based on title alone, and
-- the AI classifier only sees regex-flagged candidates.
--
-- Fix: a separate daily job downloads each PDF-URL finding, extracts
-- text via pdf-parse, stores up to 50KB of it, and re-runs the regex
-- classifier on (title + pdf_text). Findings that newly classify as
-- kratom_direct / kratom_adjacent get picked up by the AI classifier
-- the next day, completing the pipeline.
-- ============================================================

alter table public.bop_findings
  add column if not exists pdf_text text,
  add column if not exists pdf_byte_count int,
  add column if not exists pdf_parsed_at timestamptz,
  add column if not exists pdf_status text,
  add column if not exists pdf_error text;

-- pdf_status values: 'ok' | 'empty' | 'too_large' | 'fetch_failed' |
--                    'parse_failed' | 'not_pdf' | 'rejected_unsafe'
alter table public.bop_findings
  drop constraint if exists bop_findings_pdf_status_chk;
alter table public.bop_findings
  add constraint bop_findings_pdf_status_chk
  check (pdf_status is null or pdf_status in (
    'ok', 'empty', 'too_large', 'fetch_failed',
    'parse_failed', 'not_pdf', 'rejected_unsafe'
  ));

-- Index for the "PDFs to parse next" queue. Limited to URLs that
-- look like PDFs (we don't want to download HTML pages just to find
-- out they aren't PDF). The classifier-relevance filter is dropped
-- — we want to parse PDFs even if title-only said 'unrelated',
-- because that's the whole point of this layer.
create index if not exists ix_bop_findings_pdf_queue
  on public.bop_findings (found_at desc)
  where pdf_parsed_at is null
    and url is not null
    and url ilike '%.pdf%';

comment on column public.bop_findings.pdf_text is
  'First ~50KB of extracted text from the linked PDF. Used by Layer 1 re-classification + Layer 2 AI classifier prompt.';
