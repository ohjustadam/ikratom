-- ============================================================
-- 0021 — Lock down public._ikratom_migrations
-- ============================================================
-- Supabase's security advisor flags this table because it's in the public
-- schema (so PostgREST exposes it) but has no RLS. The table is just a
-- migration ledger written by scripts/db-push.mjs via the service role,
-- which bypasses RLS. So enabling RLS with no policies is the right fix:
--   - service role still writes (bypasses RLS)
--   - anon + authenticated callers get nothing (no SELECT, no INSERT)
-- ============================================================

alter table if exists public._ikratom_migrations enable row level security;

-- (intentionally no policies — this table is for the migration runner only)

-- Belt-and-suspenders: revoke direct SQL grants from the API roles too,
-- in case PostgREST changes its row-policy semantics in the future.
revoke all on table public._ikratom_migrations from anon, authenticated;
