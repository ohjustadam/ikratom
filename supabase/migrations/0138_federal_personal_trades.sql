-- 0138 — Federal STOCK Act personal-trade disclosures.
--
-- D3 from the original Phase 3 plan. Federal legislators must file
-- Periodic Transaction Reports (PTRs) within 30 days of a personal
-- stock trade by them, their spouse, or dependents. The PDFs live
-- at efdsearch.senate.gov (Senate) and disclosures-clerk.house.gov
-- (House). Parsing PDFs ourselves is ~3 days of work, BUT two community
-- projects already did it:
--   - Senate Stock Watcher (github.com/timothycarambat/senate-stock-
--     watcher-data) — JSON dump of every Senate PTR transaction
--   - House Stock Watcher (house-stock-watcher-data S3 bucket) —
--     same for House
--
-- This table captures both. Each row = one transaction line.
--
-- Why we care (the kratom angle): a senator who owns pharma stock
-- while voting against kratom is a documentable conflict signal.
-- Mullin-Botanic-Tonics is the prototype — a senator with industry-
-- adjacent personal financial exposure influences how they vote on
-- kratom rules. We surface trades that overlap with kratom-adjacent
-- industries (pharma opioid manufacturers, addiction treatment firms,
-- kratom-vendor parent companies, herbal-supplement conglomerates).
--
-- Rollback:
--   DROP TABLE IF EXISTS public.federal_personal_trades;

CREATE TABLE IF NOT EXISTS public.federal_personal_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance / dedup
  source text NOT NULL DEFAULT 'senate_stock_watcher',  -- 'senate_stock_watcher' | 'house_stock_watcher'
  chamber text NOT NULL,                                 -- 'senate' | 'house'
  ptr_link text,                                         -- canonical disclosure URL
  ptr_uuid text,                                         -- internal id from the source data

  -- Who
  legislator_name text NOT NULL,                         -- raw name as in disclosure
  legislator_id uuid REFERENCES public.legislators(id) ON DELETE SET NULL,
  owner text,                                            -- 'self' | 'Spouse' | 'Dependent' | 'Joint'

  -- What
  ticker text,                                           -- stock symbol, when present
  asset_description text NOT NULL,                       -- "The Boeing Company"
  asset_type text,                                       -- 'Stock' | 'Option' | 'Bond' | etc.

  -- Trade
  transaction_date date,                                 -- when the trade happened
  filing_date date,                                      -- when the PTR was filed (lateness signal)
  transaction_type text,                                 -- 'Purchase' | 'Sale (Full)' | 'Sale (Partial)' | 'Exchange'
  amount_range text,                                     -- "$50,001 - $100,000"
  amount_lower numeric,                                  -- parsed lower bound for sortable queries
  amount_upper numeric,                                  -- parsed upper bound
  comment text,

  -- Our analysis
  is_kratom_adjacent boolean DEFAULT false,              -- ticker/asset matches kratom-adjacent industries
  kratom_relevance_note text,                            -- why we flagged it (e.g. "Endo Pharmaceuticals - opioid maker")

  -- Raw
  raw_json jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),

  -- Dedup. Senate Stock Watcher includes a stable ptr_link; if we
  -- have that, use (ptr_link, ticker, transaction_date, owner) as
  -- the natural key. Some entries lack ptr_link, so we fall back to
  -- the synthesized key (legislator_name, ticker, transaction_date,
  -- transaction_type, amount_range).
  UNIQUE(chamber, legislator_name, ticker, transaction_date, transaction_type, amount_range, owner)
);

CREATE INDEX IF NOT EXISTS federal_trades_legislator_idx
  ON public.federal_personal_trades (legislator_id)
  WHERE legislator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS federal_trades_legislator_name_idx
  ON public.federal_personal_trades (legislator_name);
CREATE INDEX IF NOT EXISTS federal_trades_transaction_date_idx
  ON public.federal_personal_trades (transaction_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS federal_trades_kratom_adjacent_idx
  ON public.federal_personal_trades (transaction_date DESC)
  WHERE is_kratom_adjacent = true;

-- =============================================================
-- RLS — public read (PTR disclosures are public record), admin write
-- =============================================================
ALTER TABLE public.federal_personal_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read federal trades" ON public.federal_personal_trades;
CREATE POLICY "Public read federal trades"
  ON public.federal_personal_trades FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write federal trades" ON public.federal_personal_trades;
CREATE POLICY "Admin write federal trades"
  ON public.federal_personal_trades FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.federal_personal_trades IS
  'STOCK Act Periodic Transaction Reports — federal legislators personal stock trades. Senate via Senate Stock Watcher GitHub JSON; House via House Stock Watcher S3. is_kratom_adjacent flag surfaces trades in pharma opioid manufacturers, addiction treatment, kratom-vendor parents — the Mullin-Botanic-Tonics pattern repeated for other reps.';
