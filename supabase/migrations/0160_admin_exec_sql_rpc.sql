-- ============================================================
-- 0160_admin_exec_sql_rpc
--
-- The admin_exec_sql RPC backs /admin/console — the remote
-- troubleshooting surface. Executes arbitrary single-statement SQL
-- and returns rows as a jsonb array.
--
-- Why this exists: when something breaks in a way no existing admin
-- page handles, the platform owner (potentially using a phone in
-- another time zone) needs a way to inspect and fix DB state without
-- shelling into Supabase Studio.
--
-- Security:
--   - SECURITY DEFINER (runs as the role that owns the function,
--     which is the migration role — has full DB access)
--   - EXECUTE granted ONLY to service_role. NOT granted to
--     authenticated or anon. This means:
--       · The function is unreachable from the Data API (PostgREST
--         routes auth based on JWT role; anon + authenticated can't
--         call it)
--       · The function is callable from the iKratom backend ONLY when
--         the backend uses the service-role client (which lives in
--         env vars never sent to the browser)
--   - The application layer (src/modules/admin/console-actions.ts)
--     enforces auth + role + blocklist + audit BEFORE calling this.
--     This RPC is the LAST line of defense, not the first.
--
-- This is intentionally NOT exposed to the Data API. If a leaked
-- anon-key tries to call rpc/admin_exec_sql, PostgREST returns 401.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.admin_exec_sql(text);

create or replace function public.admin_exec_sql(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- Wrap arbitrary SQL in a CTE and aggregate the result set as
  -- jsonb. Works for SELECT queries that return rows.
  --
  -- For mutation statements (INSERT/UPDATE/DELETE), Postgres returns
  -- 0 rows from the EXECUTE; we return an empty array. The caller
  -- knows it was a mutation because they passed `acknowledge: true`.
  --
  -- Note: this WILL throw a Postgres exception if the SQL is invalid
  -- — that's expected, the application layer surfaces it as an error.
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t',
    p_sql
  ) into v_result;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Explicitly revoke from anon + authenticated.
revoke all on function public.admin_exec_sql(text) from public;
revoke all on function public.admin_exec_sql(text) from anon;
revoke all on function public.admin_exec_sql(text) from authenticated;

-- Grant to service_role only. The application's service-role client
-- (used by console-actions.ts) will be able to call this; anyone
-- else will get a permission-denied error.
grant execute on function public.admin_exec_sql(text) to service_role;

comment on function public.admin_exec_sql(text) is
  'Internal RPC backing /admin/console. SECURITY DEFINER + service-role-only. Application layer enforces auth + role + blocklist + audit log BEFORE calling. Never expose to anon or authenticated.';
