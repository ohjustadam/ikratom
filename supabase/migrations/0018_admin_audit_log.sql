-- ============================================================
-- 0018 — Admin audit log
-- ============================================================
-- Append-only record of sensitive admin actions. Reads are admin-only via
-- RLS. Writes happen via the service-role client (see src/lib/audit.ts) so
-- that audit-table policies don't need to grant authenticated INSERT — which
-- would let any logged-in user forge entries.
--
-- Schema is intentionally loose (text columns, jsonb details) so we never
-- have to alter the table to log a new kind of action — just pick a new
-- action label.
-- ============================================================

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

create index if not exists admin_audit_log_action_idx
  on public.admin_audit_log (action, created_at desc);

-- ============================================================
-- RLS — admins can read, no one writes via PostgREST
-- ============================================================
alter table public.admin_audit_log enable row level security;

drop policy if exists "audit_admin_read" on public.admin_audit_log;
create policy "audit_admin_read" on public.admin_audit_log
  for select using (public.is_admin(auth.uid()));

-- (no insert/update/delete policies — service role bypasses RLS, normal
-- clients are blocked. The log is append-only by design; nobody can edit
-- or delete entries through the API.)
