-- 0116: Research paper library.
--
-- A trusted, unbiased corpus of peer-reviewed kratom + 7-OH research.
-- Ingested from PubMed (free API, no key needed) + supplemented with
-- Semantic Scholar citation counts + Retraction Watch retraction status.
--
-- Every paper gets an AI-evaluation pass producing:
--   - methodology_quality (1-5)
--   - sample_size_adequate (boolean) + explanation
--   - bias_indicators (array of flagged concerns)
--   - evidence_strength (strong / moderate / weak / preliminary)
--   - key_findings_md (markdown summary, non-distorting)
--   - relevance_natural_leaf vs relevance_7oh (each 0..1)
--
-- The AI evaluation is conservative and is shown alongside the
-- original abstract — never replaces it. Users see the original first,
-- AI rating second. Admin can override scores.
--
-- Rollback:
--   DROP TABLE IF EXISTS research_papers;

CREATE TABLE IF NOT EXISTS research_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  pubmed_id text UNIQUE,                        -- PMID — primary key when present
  doi text,
  semantic_scholar_id text,
  -- Bibliographic
  title text NOT NULL,
  authors text[],                                -- ["Smith J", "Doe A"]
  journal text,
  journal_iso_abbreviation text,
  publication_year int,
  publication_date date,
  -- Content
  abstract text,
  full_text_url text,                            -- PMC link if open access
  pdf_url text,
  -- Classification (regex + AI)
  topics text[],                                 -- ['natural_leaf', '7oh', 'addiction', 'harm_reduction', 'pharmacology', etc.]
  study_type text,                               -- 'review' | 'rct' | 'observational' | 'case_report' | 'in_vitro' | 'animal' | 'survey' | 'preprint'
  -- AI evaluation (always conservative, never overrides original)
  ai_methodology_quality int CHECK (ai_methodology_quality BETWEEN 1 AND 5),
  ai_sample_size_adequate boolean,
  ai_sample_size_notes text,
  ai_bias_indicators text[],
  ai_evidence_strength text CHECK (ai_evidence_strength IN ('strong', 'moderate', 'weak', 'preliminary', 'inconclusive')),
  ai_key_findings_md text,
  ai_relevance_natural_leaf numeric,             -- 0..1
  ai_relevance_7oh numeric,                      -- 0..1
  ai_distinguishes_natural_vs_synthetic boolean, -- did the paper itself make the distinction? (important quality signal)
  ai_evaluated_at timestamptz,
  ai_evaluated_by_provider text,
  -- Citations + retraction
  citation_count int,
  retracted boolean DEFAULT false,
  retraction_url text,
  retraction_reason text,
  -- Admin overrides
  admin_quality_override int,                    -- if set, used instead of ai_methodology_quality
  admin_notes_md text,
  -- Lifecycle
  is_active boolean NOT NULL DEFAULT true,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  ingested_via text                              -- 'pubmed' | 'manual' | 'crossref'
);

CREATE INDEX IF NOT EXISTS ix_research_papers_year ON research_papers(publication_year DESC) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS ix_research_papers_topics ON research_papers USING gin (topics);
CREATE INDEX IF NOT EXISTS ix_research_papers_pubmed ON research_papers(pubmed_id) WHERE pubmed_id IS NOT NULL;

ALTER TABLE research_papers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active research" ON research_papers;
CREATE POLICY "Public read active research"
  ON research_papers FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Admin write research" ON research_papers;
CREATE POLICY "Admin write research"
  ON research_papers FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE research_papers IS
  'Peer-reviewed research on kratom + 7-OH. Ingested from PubMed, AI-evaluated for methodology + bias, admin-curated. Surfaces at /research. Original abstract always shown alongside AI rating, never replaced.';
