-- ============================================================
-- 0219 — SECURITY DEFINER hardening: pin search_path + finish RPC grant revokes
-- ============================================================
-- Round-3 verification (live pg_proc audit). Two residual items, both LOW (the
-- functions are cron/service-role-only and PostgREST gives no way to SET
-- search_path), fixed for defense-in-depth + best practice:
--
-- (A) Three SECURITY DEFINER functions had no fixed search_path — a definer
--     function should always pin it so object resolution can't be hijacked.
-- (B) prune_trusted_devices + bop_stale_source_sweep were still executable by
--     anon/authenticated (0217 covered the other internal RPCs but skipped these
--     two pending a caller check; confirmed cron/service-role-only). Revoke the
--     default PUBLIC grant; keep service_role.
--
-- Rollback: the ALTERs are harmless to leave; re-grant execute to public to undo (B).

-- (A) pin search_path
alter function public.prune_ai_jobs()        set search_path = public;
alter function public.prune_email_quota_log() set search_path = public;
alter function public.prune_trusted_devices() set search_path = public;

-- (B) lock the two cron-only functions to service_role
revoke execute on function public.prune_trusted_devices() from public, anon, authenticated;
grant  execute on function public.prune_trusted_devices() to service_role;
revoke execute on function public.bop_stale_source_sweep() from public, anon, authenticated;
grant  execute on function public.bop_stale_source_sweep() to service_role;
