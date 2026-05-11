-- ============================================================
-- 0094_bop_ai_classifier
--
-- Adds AI-classification columns to bop_findings. The regex classifier
-- (Layer 1) is the fast first pass that flags candidates as
-- kratom_direct / kratom_adjacent based on title patterns. The AI
-- classifier (Layer 2) is the second pass — Gemini Flash 2.5 with
-- Google Search grounding reads the linked PDF/page and gives a
-- structured verdict with confidence + reasoning.
--
-- Display logic (in BopWatchSummary + /admin/bop-monitor):
--   coalesce(reviewed_relevance, ai_relevance, classified_relevance)
-- Admin review wins, then AI, then regex.
-- ============================================================

alter table public.bop_findings
  add column if not exists ai_relevance text,
  add column if not exists ai_severity text,
  add column if not exists ai_confidence numeric(3,2),
  add column if not exists ai_reasoning text,
  add column if not exists ai_sources jsonb,
  add column if not exists ai_classified_at timestamptz,
  add column if not exists ai_model text;

-- Constraints: only the same enum values the regex pass uses.
alter table public.bop_findings
  drop constraint if exists bop_findings_ai_relevance_chk;
alter table public.bop_findings
  add constraint bop_findings_ai_relevance_chk
  check (ai_relevance is null or ai_relevance in (
    'kratom_direct', 'kratom_adjacent', 'unrelated'
  ));

alter table public.bop_findings
  drop constraint if exists bop_findings_ai_severity_chk;
alter table public.bop_findings
  add constraint bop_findings_ai_severity_chk
  check (ai_severity is null or ai_severity in (
    'hostile_proposal', 'discussion_only', 'supportive', 'neutral', 'unknown'
  ));

alter table public.bop_findings
  drop constraint if exists bop_findings_ai_confidence_chk;
alter table public.bop_findings
  add constraint bop_findings_ai_confidence_chk
  check (ai_confidence is null or (ai_confidence >= 0 and ai_confidence <= 1));

-- Partial index for the "give me findings that need AI review" queue.
-- Regex-flagged candidates that haven't been AI-classified yet,
-- excluding admin-reviewed rows.
create index if not exists ix_bop_findings_ai_queue
  on public.bop_findings (found_at desc)
  where ai_classified_at is null
    and reviewed_at is null
    and classified_relevance in ('kratom_direct', 'kratom_adjacent');

-- Update the public RPC to expose AI verdict alongside the regex one.
-- The /bop-watch + BopWatchSummary embed prefer AI when present.
drop function if exists public.get_public_bop_findings(int);
create or replace function public.get_public_bop_findings(p_days int default 60)
returns table (
  id uuid,
  state text,
  title text,
  snippet text,
  url text,
  meeting_date date,
  relevance text,
  severity text,
  ai_confidence numeric,
  ai_reasoning text,
  alert_emitted_at timestamptz,
  found_at timestamptz,
  board_name text,
  surface text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.state,
    f.title,
    f.snippet,
    f.url,
    f.meeting_date,
    -- Layered relevance: admin > AI > regex
    coalesce(f.reviewed_relevance, f.ai_relevance, f.classified_relevance) as relevance,
    coalesce(f.reviewed_severity, f.ai_severity, f.classified_severity) as severity,
    f.ai_confidence,
    -- Only expose AI reasoning if confidence is decent — prevents
    -- hallucinated low-confidence rationales from misleading users.
    case when f.ai_confidence is not null and f.ai_confidence >= 0.6
      then f.ai_reasoning
      else null
    end as ai_reasoning,
    f.alert_emitted_at,
    f.found_at,
    s.board_name,
    s.surface
  from public.bop_findings f
  join public.bop_sources s on s.id = f.source_id
  where f.found_at > now() - (p_days || ' days')::interval
    and coalesce(f.reviewed_relevance, f.ai_relevance, f.classified_relevance)
        in ('kratom_direct', 'kratom_adjacent')
    and (f.reviewed_relevance is null or f.reviewed_relevance <> 'unrelated')
  order by f.found_at desc;
$$;

grant execute on function public.get_public_bop_findings(int) to authenticated, anon;

-- Update the auto-notify trigger so admins are alerted only when
-- BOTH regex AND AI agree on kratom_direct (or AI alone with high
-- confidence). Reduces false-positive notification spam.
create or replace function public.notify_admins_on_bop_finding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_severity text;
  v_should_notify boolean;
begin
  -- Decide whether to notify. Conservative gates:
  --   1. Regex says kratom_direct AND AI hasn't yet classified -> notify
  --      (we want admin to see candidates pre-AI-pass)
  --   2. AI says kratom_direct with confidence >= 0.7 -> notify
  --   3. Otherwise stay quiet.
  v_should_notify := (
    (new.classified_relevance = 'kratom_direct' and new.ai_classified_at is null)
    or
    (new.ai_relevance = 'kratom_direct' and coalesce(new.ai_confidence, 0) >= 0.7)
  );
  if not v_should_notify then return new; end if;

  v_severity := coalesce(new.ai_severity, new.classified_severity);
  v_title := case
    when v_severity = 'hostile_proposal' then
      '🚨 ' || new.state || ' BoP: hostile kratom rule detected'
    else
      '⚠ ' || new.state || ' BoP: kratom mention in agenda'
  end;

  insert into public.notifications (user_id, kind, title, body, link)
  select p.id,
         'bop_finding_direct',
         v_title,
         left(coalesce(new.title, ''), 240),
         '/admin/bop-monitor'
    from public.profiles p
   where p.is_admin = true or p.is_owner = true
  on conflict do nothing;

  return new;
end;
$$;

-- Same trigger fires on UPDATE too now, so when the AI classifier
-- promotes a regex-adjacent finding to direct, admins get the ping.
drop trigger if exists trg_bop_finding_admin_notify on public.bop_findings;
create trigger trg_bop_finding_admin_notify
  after insert or update of ai_relevance, ai_severity, ai_confidence
  on public.bop_findings
  for each row
  execute function public.notify_admins_on_bop_finding();

comment on column public.bop_findings.ai_relevance is
  'AI-grounded relevance verdict from Gemini Flash 2.5 with Google Search. Layer 2 classifier; overrides classified_relevance for display purposes.';
comment on column public.bop_findings.ai_confidence is
  'AI confidence score 0..1. Reasoning hidden in public view if below 0.6 to avoid surfacing low-confidence hallucinations.';
