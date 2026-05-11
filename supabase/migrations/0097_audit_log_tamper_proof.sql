-- ============================================================
-- 0097_audit_log_tamper_proof
--
-- The admin_audit_log table has good RLS (admin-read, no insert/update/
-- delete policies for authenticated users) — but the service role
-- bypasses RLS, so a compromise of SUPABASE_SERVICE_ROLE_KEY would let
-- an attacker tamper with or delete audit history to cover their tracks.
--
-- This adds a row-level trigger that REJECTS any UPDATE or DELETE on
-- the table, regardless of caller. Triggers run AFTER RLS but BEFORE
-- the actual data modification, and apply to the service role too.
-- ============================================================

create or replace function public.deny_audit_log_tamper()
returns trigger
language plpgsql
as $$
begin
  raise exception 'admin_audit_log is append-only; UPDATE/DELETE not permitted (op=%)', tg_op
    using errcode = '42501'; -- insufficient_privilege
end;
$$;

drop trigger if exists trg_audit_log_no_update on public.admin_audit_log;
create trigger trg_audit_log_no_update
  before update on public.admin_audit_log
  for each row execute function public.deny_audit_log_tamper();

drop trigger if exists trg_audit_log_no_delete on public.admin_audit_log;
create trigger trg_audit_log_no_delete
  before delete on public.admin_audit_log
  for each row execute function public.deny_audit_log_tamper();

comment on function public.deny_audit_log_tamper is
  'Append-only enforcement for admin_audit_log. Triggered BEFORE UPDATE/DELETE; raises 42501. Works against service role too (RLS does not).';

-- Note: a DBA with direct Postgres superuser access can still drop the
-- triggers, but that requires admin-level DB access well beyond what
-- the service-role API key grants. Defense-in-depth, not absolute.
