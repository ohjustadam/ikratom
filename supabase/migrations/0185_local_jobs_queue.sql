-- 0185_local_jobs_queue.sql
-- The local-worker bridge: a job queue that lets the owner's local "heavy tier"
-- (PC with GPU + Ollama) do what free-tier cloud can't — Kokoro TTS renders,
-- Whisper transcription, agentic LLM work — WITHOUT ever exposing the machine.
--
-- Flow: the deployed app / cron ENQUEUES a job (insert here). A local worker
-- (scripts/local-worker.mjs) running on the PC PULLS the next job via the
-- claim_local_job() RPC (atomic, FOR UPDATE SKIP LOCKED), does the work, and
-- PUSHES the result back. Outbound-only: the PC connects to Supabase, nothing
-- connects to the PC. Box off → jobs simply wait in the queue.
--
-- Rollback: drop function claim_local_job; drop table local_jobs.

create table if not exists public.local_jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                 -- 'tts_render' | 'transcribe' | 'agent_query' | ...
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  priority      integer not null default 100,  -- lower = sooner
  attempts      integer not null default 0,
  max_attempts  integer not null default 3,
  result        jsonb,
  error         text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- Fast "next queued job" scan.
create index if not exists ix_local_jobs_queued
  on public.local_jobs (priority asc, created_at asc) where status = 'queued';
create index if not exists ix_local_jobs_status on public.local_jobs (status, locked_at);

comment on table public.local_jobs is
  'Job queue for the local-worker bridge (scripts/local-worker.mjs). App/cron enqueues; the owner''s PC pulls + processes + pushes results. Outbound-only; the PC is never exposed.';

-- Atomic claim: grab the highest-priority queued job (optionally filtered to the
-- kinds this worker handles), flip it to running, bump attempts. SKIP LOCKED so
-- multiple workers never grab the same job. Returns the row, or NULL if none.
create or replace function public.claim_local_job(p_kinds text[] default null)
returns public.local_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.local_jobs;
begin
  update public.local_jobs
     set status = 'running', locked_at = now(), attempts = attempts + 1
   where id = (
     select id from public.local_jobs
      where status = 'queued'
        and (p_kinds is null or kind = any(p_kinds))
      order by priority asc, created_at asc
      for update skip locked
      limit 1
   )
  returning * into j;
  return j;
end;
$$;

-- RLS: admins can SEE the queue (for an /admin view later). No app-layer
-- write policy — only the service-role worker/enqueuer writes (it bypasses RLS).
alter table public.local_jobs enable row level security;
drop policy if exists local_jobs_admin_read on public.local_jobs;
create policy local_jobs_admin_read
  on public.local_jobs for select to authenticated
  using (public.is_admin(auth.uid()));

grant execute on function public.claim_local_job(text[]) to service_role;
