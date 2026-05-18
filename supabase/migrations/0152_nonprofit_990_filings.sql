-- 0152 — IRS Form 990 filings for kratom-policy-aligned 501(c)(3)/(c)(4) orgs.
--
-- Surfaces topline finances + officer compensation for AKA, GKC, BEA,
-- and similar orgs that drive kratom policy via lobbying + advocacy.
-- Source: ProPublica Nonprofit Explorer API (free, no auth).
--
-- 501(c)(4)s don't disclose donors — the "dark money" structural gap —
-- but 990s do disclose total revenue, total expenses, and key-employee
-- compensation. Useful signal for "how much money flows through these
-- orgs and to whom."
--
-- Rollback:
--   DROP TABLE IF EXISTS public.nonprofit_990_filings;

CREATE TABLE IF NOT EXISTS public.nonprofit_990_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ein text NOT NULL,
  org_name text NOT NULL,
  tax_year integer NOT NULL,
  total_revenue numeric,
  total_expenses numeric,
  total_compensation numeric,
  officer_compensation numeric,
  total_assets_eoy numeric,
  total_liabilities_eoy numeric,
  -- Top officers + their compensation as a JSON array; ProPublica
  -- exposes this when the org filed 990 (not 990-EZ / 990-N).
  officers jsonb DEFAULT '[]',
  pdf_url text,
  source_url text,
  raw_json jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ein, tax_year)
);

CREATE INDEX IF NOT EXISTS nonprofit_990_ein_idx
  ON public.nonprofit_990_filings (ein, tax_year DESC);

ALTER TABLE public.nonprofit_990_filings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read 990s" ON public.nonprofit_990_filings;
CREATE POLICY "Public read 990s"
  ON public.nonprofit_990_filings FOR SELECT
  USING (true);
DROP POLICY IF EXISTS "Admin write 990s" ON public.nonprofit_990_filings;
CREATE POLICY "Admin write 990s"
  ON public.nonprofit_990_filings FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.nonprofit_990_filings IS
  'IRS Form 990 filings for kratom-policy-aligned orgs (AKA, GKC, BEA, etc.). Source: ProPublica Nonprofit Explorer.';
