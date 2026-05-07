-- ============================================================
-- 0046_ai_jobs
--
-- Logs every AI router invocation: which provider was used, what task
-- kind, latency, token counts, success/failure. Powers the AI Command
-- Center dashboard at /admin/ai-control and gives us a paper trail for
-- cost auditing + retry workflows.
--
-- Design notes:
--   - Prompt + output are stored truncated (first 800 chars each) — full
--     content can be huge and we don't need it for diagnostics most of
--     the time. If full preservation matters for a task, the caller
--     can write to its own table.
--   - status enum is checked: 'pending' (job submitted, not done),
--     'success', 'failure'. No retry counter — caller decides retry
--     policy. We log a new row per attempt.
--   - error column is nullable; only populated on failure.
--   - provider_used can differ from initial provider when the router
--     fell back. We capture both in metadata for that case.
--   - cost_usd is best-effort; some providers (Ollama) cost $0, others
--     have variable pricing. We compute from token counts when known.
--   - PARTITIONED on month would be nice at scale but is YAGNI for v1.
--
-- Volume estimate: 10K AI calls/day = 300K rows/month, ~10MB. Fine.
-- ============================================================

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null,
  provider_used text,
  model_used text,
  status text not null check (status in ('pending', 'success', 'failure')) default 'pending',
  prompt_preview text,         -- truncated to 800 chars
  output_preview text,         -- truncated to 800 chars
  tokens_input int,
  tokens_output int,
  cost_usd numeric(10, 6),     -- estimated, nullable
  elapsed_ms int,
  error text,
  caller text,                 -- which script / route called the AI
  user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb,              -- {fallback_chain: ["gemini","groq"], constraints: {...}}
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_ai_jobs_created_at on public.ai_jobs (created_at desc);
create index if not exists idx_ai_jobs_status on public.ai_jobs (status, created_at desc) where status = 'failure';
create index if not exists idx_ai_jobs_caller on public.ai_jobs (caller, created_at desc);

alter table public.ai_jobs enable row level security;

-- Admin-only read (the dashboard at /admin/ai-control)
drop policy if exists "ai_jobs_admin_read" on public.ai_jobs;
create policy "ai_jobs_admin_read"
  on public.ai_jobs for select to authenticated
  using (public.is_admin(auth.uid()));

-- Writes via service-role only (router runs in server actions / cron contexts)
-- so no user-facing INSERT policy needed.

-- Aggregate function: returns recent provider activity for the dashboard.
create or replace function public.ai_jobs_stats(p_hours int default 24)
returns table (
  provider_used text,
  task_kind text,
  successes int,
  failures int,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cost_usd numeric,
  avg_elapsed_ms int
)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce(provider_used, 'unknown')::text,
    task_kind,
    count(*) filter (where status = 'success')::int as successes,
    count(*) filter (where status = 'failure')::int as failures,
    coalesce(sum(tokens_input), 0)::bigint as total_input_tokens,
    coalesce(sum(tokens_output), 0)::bigint as total_output_tokens,
    coalesce(sum(cost_usd), 0)::numeric as total_cost_usd,
    coalesce(avg(elapsed_ms)::int, 0) as avg_elapsed_ms
  from public.ai_jobs
  where created_at >= now() - make_interval(hours => p_hours)
  group by 1, 2
  order by count(*) desc;
$$;

revoke all on function public.ai_jobs_stats(int) from public;
grant execute on function public.ai_jobs_stats(int) to authenticated;

-- Prune helper — keep 90 days of detailed history, then drop.
create or replace function public.prune_ai_jobs()
returns void
language sql
security definer
as $$
  delete from public.ai_jobs where created_at < now() - interval '90 days';
$$;
