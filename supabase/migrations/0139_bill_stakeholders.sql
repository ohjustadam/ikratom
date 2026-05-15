-- 0139 — Bill stakeholders: people of interest beyond gov officials.
--
-- Owner directive: "if there are other places or people that
-- advocates should contact to help stop the ban that arent working
-- directly on the bill then you may include them as well as people
-- of interest, rather than gov officials, and list their title,
-- company, ect, and reasoning."
--
-- Existing tables only cover:
--   bill_sponsors — gov officials who CARRY the bill
--   legislators — gov officials (the people you contact)
--   industry actor registry — kratom-industry players (lobbyists etc.)
--
-- What's missing: doctors, researchers, business owners, community
-- leaders, journalists who have spoken on the record, faith leaders,
-- harm-reduction advocates — people advocates can reach out to as
-- ALLIES for testimony, expert support, or community amplification.
-- This table holds those.
--
-- Each row is editorial (admin curation) but the schema supports
-- per-bill linkage so we can scope "who to call for SUFFOLK RES
-- 1279-2026" specifically vs generic kratom advocates.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.bill_stakeholders;

CREATE TABLE IF NOT EXISTS public.bill_stakeholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,

  -- The person
  name text NOT NULL,
  title text,                                  -- "Adjunct Prof of Pharmacy" / "Owner, X Coffee Shop"
  organization text,                           -- "University of Florida" / "City Coffee Co"
  role_type text NOT NULL DEFAULT 'ally'
    CHECK (role_type IN (
      'ally',           -- someone advocates should contact to help fight the bill
      'opponent',       -- someone publicly supporting the bill (non-sponsor)
      'expert',         -- subject-matter expert (doctor, researcher) who's testified or spoken
      'affected',       -- business owner, kratom user with personal stake
      'journalist',     -- reporter who's covered this beat (good for tip-offs)
      'community'       -- faith leader, community organizer, harm-reduction advocate
    )),

  -- Why they matter for THIS bill
  reasoning text NOT NULL,                     -- editorial 1-2 sentence justification

  -- How to reach them (optional — only fill what's public + appropriate)
  email text,
  phone text,
  website text,
  twitter_handle text,
  linkedin_url text,

  -- Provenance
  added_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_url text,                             -- where we found this person's relevance
  notes text,                                  -- internal notes

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bill_stakeholders_bill_idx
  ON public.bill_stakeholders (bill_id);
CREATE INDEX IF NOT EXISTS bill_stakeholders_role_idx
  ON public.bill_stakeholders (bill_id, role_type);

-- =============================================================
-- RLS — public read (these are publicly-listed contacts already),
-- admin + owner write. Users can add their own (will be flagged for
-- moderation via a separate flow).
-- =============================================================
ALTER TABLE public.bill_stakeholders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read bill stakeholders" ON public.bill_stakeholders;
CREATE POLICY "Public read bill stakeholders"
  ON public.bill_stakeholders FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write bill stakeholders" ON public.bill_stakeholders;
CREATE POLICY "Admin write bill stakeholders"
  ON public.bill_stakeholders FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.bill_stakeholders IS
  'People of interest tied to a specific bill — allies, experts, affected business owners, journalists, community leaders. Different from bill_sponsors (gov officials carrying the bill) and legislators (gov officials in general). Editorial curation; surfaces on the bill detail page.';
