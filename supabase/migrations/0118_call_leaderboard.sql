-- 0118: call_leaderboard RPC for /calls/leaderboard.
--
-- Aggregates call_sessions counts per user without exposing
-- individual sessions, transcripts, or recipients. Privacy:
--   - returns only user_id + count + state + distinct_recipients
--   - SECURITY DEFINER lets anyone (including anon) call it
--   - rows include both private + public profiles — the page's
--     UI layer joins to get_public_profiles to anonymize the
--     non-public ones.
--
-- The state column is denormalized on call_sessions; we surface
-- only the most recent state the user called from. This is the
-- same state that get_public_profile would return for public
-- users so the page can render "Advocate from FL" consistently.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.call_leaderboard(timestamptz, int);

CREATE OR REPLACE FUNCTION public.call_leaderboard(
  p_since timestamptz DEFAULT NULL,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  user_id uuid,
  count bigint,
  state text,
  distinct_recipients bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    cs.user_id,
    count(*)::bigint AS count,
    -- mode-ish: most common state for this user's calls
    (SELECT cs2.state
       FROM call_sessions cs2
      WHERE cs2.user_id = cs.user_id
        AND cs2.state IS NOT NULL
        AND (p_since IS NULL OR cs2.started_at >= p_since)
      GROUP BY cs2.state
      ORDER BY count(*) DESC
      LIMIT 1) AS state,
    count(DISTINCT cs.recipient_name)::bigint AS distinct_recipients
  FROM call_sessions cs
  WHERE cs.ended_at IS NOT NULL
    AND (p_since IS NULL OR cs.started_at >= p_since)
  GROUP BY cs.user_id
  ORDER BY count(*) DESC
  LIMIT GREATEST(p_limit, 1);
$$;

GRANT EXECUTE ON FUNCTION public.call_leaderboard(timestamptz, int)
  TO authenticated, anon;

COMMENT ON FUNCTION public.call_leaderboard(timestamptz, int) IS
  'Aggregate leaderboard of top callers for /calls/leaderboard. SECURITY DEFINER — exposes counts only, no transcripts or recipient details. Privacy is layered on by joining to get_public_profiles in the UI.';
