-- 0227: research_papers column-level privacy (close anon PII leak)
--
-- Problem (pen-test 2026-07-02, HIGH): the "Public read active research"
-- RLS policy (0116) grants SELECT to ALL roles including the anon PostgREST
-- role, with no column restriction. Two columns carry submitter PII/identity:
--   * admin_notes_md        — the submit actions embedded "Submitted by
--                             <full_name|email>" (real name or email)
--   * uploaded_storage_path — begins with the submitter's user UUID
--                             ("{user_id}/...")
-- Because NEXT_PUBLIC_SUPABASE_ANON_KEY is a public client value, anyone
-- could `select=admin_notes_md,uploaded_storage_path` directly against
-- PostgREST and de-anonymize every research submitter. This violates the
-- load-bearing public-anonymity rule (identity only via @username).
--
-- Fix: column-level privileges. Postgres can't "subtract" a column from a
-- table-level SELECT grant, so we REVOKE the table-level SELECT and re-GRANT
-- SELECT on only the public-safe columns. RLS (is_active=true) still applies
-- on top — both must allow. admin_notes_md / uploaded_storage_path /
-- submitted_by become readable ONLY via the service-role client (which
-- bypasses grants) — used by the detail page's signed-URL fetch and the
-- admin autofill action. NOTE (fail-safe): any NEW column added later is NOT
-- anon-readable until explicitly added to the GRANT below — intentional, so
-- a future admin field can't silently leak.
--
-- Rollback:
--   GRANT SELECT ON public.research_papers TO anon, authenticated;
--   ALTER TABLE public.research_papers DROP COLUMN IF EXISTS submitted_by;

-- Structured, admin-only submitter reference (replaces PII-in-notes).
ALTER TABLE public.research_papers
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Drop the blanket column privilege, then re-grant only public-safe columns.
REVOKE SELECT ON public.research_papers FROM anon, authenticated;

GRANT SELECT (
  id, pubmed_id, doi, semantic_scholar_id,
  title, authors, journal, journal_iso_abbreviation,
  publication_year, publication_date, abstract, full_text_url, pdf_url,
  topics, study_type,
  ai_methodology_quality, ai_sample_size_adequate, ai_sample_size_notes,
  ai_bias_indicators, ai_evidence_strength, ai_key_findings_md,
  ai_relevance_natural_leaf, ai_relevance_7oh, ai_distinguishes_natural_vs_synthetic,
  ai_evaluated_at, ai_evaluated_by_provider,
  citation_count, retracted, retraction_url, retraction_reason,
  admin_quality_override, is_active, ingested_at, ingested_via
) ON public.research_papers TO anon, authenticated;

-- INSERT/UPDATE/DELETE stay governed by the "Admin write research" policy
-- (is_admin) + Postgres defaults; leaders submit via the SECURITY-scoped
-- server actions using their own session, so keep authenticated INSERT able
-- to write all columns (RLS WITH CHECK still gates it). No write-grant change.
