-- 0123 — bills.current_committee_* + backfill from bill_actions
--
-- Mission lever: when a bill sits in committee X, the ~10-20
-- legislators ON committee X are the only people whose vote moves
-- the bill. The constituents of THOSE legislators are the only
-- constituents whose calls/emails have leverage on that step.
-- Lobbyists know this and target precisely. Advocates usually don't.
--
-- These columns let us render a "YOUR REP IS DECIDING THIS BILL"
-- callout on /bills/[id] when the signed-in user's reps sit on
-- the bill's current committee.
--
-- Population strategy:
--   1. This migration adds columns + backfills from bill_actions
--      by regex-matching the most recent action description per
--      bill that mentions a committee name.
--   2. Going forward: scripts/enrich-bills*.mjs runs the same regex
--      on each new action and writes to current_committee_name.
--
-- Rollback: `ALTER TABLE bills DROP COLUMN current_committee_name,
-- DROP COLUMN current_committee_chamber, DROP COLUMN
-- current_committee_updated_at;` — safe; UI gracefully hides when null.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS current_committee_name text,
  ADD COLUMN IF NOT EXISTS current_committee_chamber text,  -- 'house' | 'senate' | 'joint'
  ADD COLUMN IF NOT EXISTS current_committee_updated_at timestamptz;

CREATE INDEX IF NOT EXISTS bills_current_committee_idx
  ON public.bills (current_committee_name)
  WHERE current_committee_name IS NOT NULL;

-- Backfill: per active bill, scan most recent bill_action whose
-- description mentions "committee" or "subcommittee" and extract
-- the committee name. The regex captures the canonical pattern:
--   "... <Chamber> <Name(s)> Committee ..."
-- e.g.
--   "Referred to Senate Health Committee"           → "Senate Health Committee"
--   "Action deferred in Senate Judiciary Committee" → "Senate Judiciary Committee"
--   "To be heard in Assembly Codes Committee"       → "Assembly Codes Committee"
--   "House Recommended for passage, refer to
--    Senate Finance, Ways, and Means Committee"     → "Senate Finance, Ways, and Means Committee"
--
-- We're permissive on whitespace + punctuation between the chamber
-- and the trailing "Committee" token; conservative on length (cap
-- at 80 chars) so we never accidentally swallow a sentence.

WITH most_recent_committee_action AS (
  SELECT DISTINCT ON (ba.bill_id)
    ba.bill_id,
    ba.action_date,
    ba.description,
    -- chamber inference from description prefix
    CASE
      WHEN ba.description ~* '\m(senate|assembly[^[:alpha:]]+codes|assembly[^[:alpha:]]+health)' THEN 'senate'
      WHEN ba.description ~* '\m(house|assembly)\M'                                              THEN 'house'
      ELSE ba.chamber
    END AS chamber_guess,
    -- committee-name extraction
    (regexp_match(
      ba.description,
      '((?:Senate|House|Assembly|Joint)[^.;]{2,80}?Committee)',
      'i'
    ))[1] AS committee_name
  FROM public.bill_actions ba
  WHERE ba.description ~* '(senate|house|assembly|joint).{2,80}?committee'
  ORDER BY ba.bill_id, ba.action_date DESC NULLS LAST
)
UPDATE public.bills b
SET
  current_committee_name = trim(mr.committee_name),
  current_committee_chamber = CASE
    WHEN mr.committee_name ~* '^\s*senate'        THEN 'senate'
    WHEN mr.committee_name ~* '^\s*(house|assembly)' THEN 'house'
    WHEN mr.committee_name ~* '^\s*joint'         THEN 'joint'
    ELSE mr.chamber_guess
  END,
  current_committee_updated_at = mr.action_date
FROM most_recent_committee_action mr
WHERE b.id = mr.bill_id
  AND b.active = true
  AND mr.committee_name IS NOT NULL
  AND length(mr.committee_name) BETWEEN 8 AND 80;

-- Optional sanity log — count how many bills got populated. Comment-
-- only since RAISE NOTICE in migrations is non-portable across our
-- direct-push tooling.
-- SELECT count(*) FROM bills WHERE current_committee_name IS NOT NULL;
