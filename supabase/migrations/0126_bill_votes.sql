-- 0126 — Bill votes (roll-call history). Phase 3 D1.
--
-- Why: knowing how Sen. X voted on 2024 KCPA tells us with high
-- confidence how she'll vote on the 2026 bill. Today our briefings
-- show STANCE (drafted from sponsorship + committee + public
-- statements) but no actual VOTING RECORD. Voting is the strongest
-- predictive signal — a "champion" stance is a guess; a YES vote
-- is a fact.
--
-- Data source: LegiScan getBill response includes a `votes` array
-- with roll_call_id + members (per-legislator vote_text). Free tier
-- already covers this; we just weren't extracting it.
--
-- Two-table design:
--   - bill_votes: one row per roll-call event (motion, date, totals)
--   - bill_vote_members: one row per legislator-vote within a roll-call
--
-- Indexes optimize the two query patterns we'll do most:
--   - per-legislator history: "show me every kratom vote Sen. X cast"
--   - per-bill latest: "what was the vote on this bill?"
--
-- Rollback:
--   DROP TABLE IF EXISTS bill_vote_members;
--   DROP TABLE IF EXISTS bill_votes;

-- =============================================================
-- 1. bill_votes — one row per roll-call event
-- =============================================================
CREATE TABLE IF NOT EXISTS public.bill_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,

  -- LegiScan identifiers (for idempotent upsert across syncs)
  legiscan_roll_call_id integer,

  -- When + where the vote happened
  vote_date date,
  chamber text,                    -- 'house' | 'senate' | (state-specific)

  -- What was being voted on
  motion text,                     -- e.g. "Third Reading Passage", "Final Passage"
  motion_id integer,               -- LegiScan motion_id when present

  -- Tallies
  yea_count integer,
  nay_count integer,
  nv_count integer,                -- not voting
  absent_count integer,
  total_count integer,
  passed boolean,                  -- did the motion carry

  -- Provenance + raw data preservation
  source text DEFAULT 'legiscan',
  raw_json jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(bill_id, legiscan_roll_call_id)
);

CREATE INDEX IF NOT EXISTS bill_votes_bill_idx ON public.bill_votes (bill_id);
CREATE INDEX IF NOT EXISTS bill_votes_date_idx ON public.bill_votes (vote_date DESC);

-- =============================================================
-- 2. bill_vote_members — per-legislator vote within a roll-call
-- =============================================================
CREATE TABLE IF NOT EXISTS public.bill_vote_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_vote_id uuid NOT NULL REFERENCES public.bill_votes(id) ON DELETE CASCADE,

  -- Match to our legislators table (nullable — sometimes LegiScan
  -- IDs don't match our records, especially for departed legislators)
  legislator_id uuid REFERENCES public.legislators(id) ON DELETE SET NULL,

  -- LegiScan's own person id — keep for cross-referencing even when
  -- legislator_id is null
  legiscan_people_id integer,

  -- Name as recorded in LegiScan (preserved for unmatched-legislator rows)
  legislator_name text,

  -- The vote itself
  vote_text text,                  -- 'Yea' | 'Nay' | 'Not Voting' | 'Absent' | etc.
  vote_value integer,              -- LegiScan numeric code: 1=Yea 2=Nay 3=NV 4=Absent

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(bill_vote_id, legiscan_people_id)
);

CREATE INDEX IF NOT EXISTS bill_vote_members_legislator_idx
  ON public.bill_vote_members (legislator_id)
  WHERE legislator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bill_vote_members_vote_idx
  ON public.bill_vote_members (bill_vote_id);

-- =============================================================
-- 3. RLS — public read (votes are public record), admin write
-- =============================================================
ALTER TABLE public.bill_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bill votes" ON public.bill_votes;
CREATE POLICY "Public read bill votes"
  ON public.bill_votes FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write bill votes" ON public.bill_votes;
CREATE POLICY "Admin write bill votes"
  ON public.bill_votes FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

ALTER TABLE public.bill_vote_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bill vote members" ON public.bill_vote_members;
CREATE POLICY "Public read bill vote members"
  ON public.bill_vote_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write bill vote members" ON public.bill_vote_members;
CREATE POLICY "Admin write bill vote members"
  ON public.bill_vote_members FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.bill_votes IS
  'Roll-call events from LegiScan. One row per motion-vote. Populated by sync-bills-via-legiscan.mjs.';
COMMENT ON TABLE public.bill_vote_members IS
  'Per-legislator vote within a roll-call. legislator_id is nullable when LegiScan IDs cannot be matched to our legislators table.';
