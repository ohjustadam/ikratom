-- 0151 — Coordinated-operation cluster detection.
--
-- The kratom industry's policy adversaries don't operate state-by-state
-- independently. They use model legislation — the same operative
-- language pushed in multiple states simultaneously by lobbyist
-- networks. Examples:
--   * KCPA (Kratom Consumer Protection Act) — age-21 + lab-testing
--     framework, originally industry-friendly, now appearing in
--     restrictive variants in 30+ states
--   * "ICE Out" — intoxicating cannabinoid extracts language that
--     sweeps in kratom alongside delta-8 / hemp products
--   * Synthetic Ban — narrow 7-OH / semisynthetic targeting
--   * Schedule I addition — outright criminalization
--
-- This table indexes detected clusters. Each cluster represents a
-- pattern of bills sharing operative language + tactical framing.
-- Bills are linked to clusters via the bill_cluster_members join table.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.bill_cluster_members CASCADE;
--   DROP TABLE IF EXISTS public.bill_clusters CASCADE;

CREATE TABLE IF NOT EXISTS public.bill_clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable handle for the cluster (e.g. "kcpa", "ice_out", "synthetic_ban").
  -- Used in URLs at /intel/operations/[slug].
  slug text NOT NULL UNIQUE,
  -- Human-readable name as it appears in headlines + UI.
  name text NOT NULL,
  -- One-paragraph summary of the operation: what the model legislation
  -- does, who promotes it, what the kratom-policy impact is.
  summary_md text,
  -- Tactical framing: bans / restricts / regulates / etc.
  posture text NOT NULL CHECK (posture IN (
    'restrictive', 'protective', 'regulatory', 'mixed'
  )),
  -- Signature operative phrases — verbatim text fragments that appear
  -- in multiple bills in the cluster. Used for forensic-style display
  -- ("here's the exact wording recurring across 7 states").
  signature_phrases text[] DEFAULT '{}',
  -- Suspected origin / promoter of the model language. Editorial
  -- judgment based on overlap with known industry lobbyists +
  -- 501(c)(4) playbooks. Examples: "AKA Consumer Protection working
  -- group", "delta-8 industry coalition", "synthetic-only carve-out
  -- (industry-friendly)".
  suspected_origin text,
  -- Bill count + state breadth (denormalized for speed; refreshed
  -- by the detector script on every run).
  bill_count integer NOT NULL DEFAULT 0,
  state_count integer NOT NULL DEFAULT 0,
  earliest_introduced date,
  latest_introduced date,

  detected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bill_clusters_posture_idx
  ON public.bill_clusters (posture);

-- Join table: each (cluster, bill) pair with detector confidence
-- and a snippet of the matched language for evidence display.
CREATE TABLE IF NOT EXISTS public.bill_cluster_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES public.bill_clusters(id) ON DELETE CASCADE,
  bill_id uuid NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
  -- 0.0 - 1.0 confidence the bill belongs to this cluster
  confidence numeric NOT NULL DEFAULT 1.0,
  -- Why this bill matched the cluster (verbatim signature phrase,
  -- title pattern, etc.) — shown to the user as evidence.
  match_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, bill_id)
);

CREATE INDEX IF NOT EXISTS bill_cluster_members_bill_idx
  ON public.bill_cluster_members (bill_id);

-- =============================================================
-- RLS — public read (intel about public legislation is public),
-- admin-only write
-- =============================================================
ALTER TABLE public.bill_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bill_cluster_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read clusters" ON public.bill_clusters;
CREATE POLICY "Public read clusters"
  ON public.bill_clusters FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write clusters" ON public.bill_clusters;
CREATE POLICY "Admin write clusters"
  ON public.bill_clusters FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Public read cluster members" ON public.bill_cluster_members;
CREATE POLICY "Public read cluster members"
  ON public.bill_cluster_members FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Admin write cluster members" ON public.bill_cluster_members;
CREATE POLICY "Admin write cluster members"
  ON public.bill_cluster_members FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

COMMENT ON TABLE public.bill_clusters IS
  'Detected coordinated-operation patterns — model legislation tactics that recur across states. Each cluster names a tactic (KCPA, ICE Out, Synthetic Ban, Schedule I), bills are linked via bill_cluster_members. Built by scripts/detect-bill-clusters.mjs.';
