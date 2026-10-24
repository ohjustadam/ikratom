-- 0279_bop_baseline_and_emit.sql
--
-- Make the BoP engine safe for ~150 new state agency sources (intel step 1,
-- every state): health-department and attorney-general newsrooms plus state
-- register / notice-of-intent pages.
--
-- 1. bop_findings.is_baseline. A source's FIRST walk returns whatever the
--    page already lists: last year's register issues, old press releases.
--    That is backlog, not news. The engine marks those rows is_baseline, and
--    anything kratom-related among them goes to the intel review queue instead
--    of being auto-published.
--
-- 2. bop_auto_emit_policy_alert (0098) could never have worked. It inserted
--    kind 'bop_rule_proposal', which policy_alerts_kind_chk does not allow, and
--    it had no exception handler. So the first hostile >= 0.85 verdict would
--    have failed the classifier's UPDATE, leaving the finding unclassified and
--    retried daily, never alerting. It had not fired yet (0 hostile verdicts).
--    Now:
--      * kind follows the source: rules / rule_proposal -> rule_filed (0278),
--        news -> news_break, meeting / agenda -> bop_hearing;
--      * moderation is 'pending' for baseline findings and for news sources
--        (a press release needs a human read). New rule and agenda findings
--        stay auto-approved, as before;
--      * the title names the agency, not "BoP", since most new sources are not
--        pharmacy boards;
--      * a failed insert raises a warning instead of failing the classifier.
--
-- Requires 0278 (the rule_filed kind).
-- Rollback: re-apply 0098's function; alter table public.bop_findings drop column is_baseline.

alter table public.bop_findings
  add column if not exists is_baseline boolean not null default false;

comment on column public.bop_findings.is_baseline is
  'True when the row came from its source''s first walk (backlog). Kratom-related baseline findings alert as pending, never auto-published (0279).';

create or replace function public.bop_auto_emit_policy_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_id uuid;
  v_src record;
  v_kind text;
  v_status text;
  v_title text;
  v_body text;
begin
  -- Only fire on the transition where AI classification was just set.
  if new.ai_classified_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.ai_classified_at is not null then
    return new;
  end if;

  -- Confidence + double-signal gates (unchanged from 0098).
  if new.ai_relevance is distinct from 'kratom_direct' then return new; end if;
  if new.ai_severity is distinct from 'hostile_proposal' then return new; end if;
  if coalesce(new.ai_confidence, 0) < 0.85 then return new; end if;
  if new.classified_relevance is distinct from 'kratom_direct' then return new; end if;
  if new.alert_emitted_at is not null then return new; end if;

  select board_name, kind into v_src from public.bop_sources where id = new.source_id;

  v_kind := case
    when v_src.kind in ('rules', 'rule_proposal') then 'rule_filed'
    when v_src.kind = 'news' then 'news_break'
    else 'bop_hearing'
  end;
  v_status := case
    when new.is_baseline or v_src.kind = 'news' then 'pending'
    else 'approved'
  end;

  v_title := '🚨 ' || new.state || ' · ' || coalesce(v_src.board_name, 'State agency')
          || ': ' || left(coalesce(new.title, ''), 120);
  v_body := 'Auto-detected by the state agency watch + AI classifier (confidence '
         || round(new.ai_confidence * 100) || '%).'
         || E'\n\n'
         || 'What the AI found: ' || coalesce(new.ai_reasoning, '(no reasoning recorded)')
         || E'\n\n'
         || 'Source: ' || coalesce(new.url, '(no direct URL)')
         || case when new.is_baseline
                 then E'\n\nFound on this source''s first scan, so it may be old: check the date before acting.'
                 else '' end;

  begin
    insert into public.policy_alerts (
      kind, severity, title, body, locality, source_url,
      moderation_status, action_required
    ) values (
      v_kind,
      'alert', -- not 'critical'; that is reserved for confirmed-enacted
      left(v_title, 300),
      v_body,
      new.state,
      new.url,
      v_status,
      true
    )
    returning id into v_alert_id;
  exception when others then
    raise warning 'bop_auto_emit_policy_alert: alert insert failed for finding %: %', new.id, sqlerrm;
    return new;
  end;

  update public.bop_findings
     set alert_emitted_at = now(),
         alert_id = v_alert_id
   where id = new.id;

  return new;
end;
$$;

comment on function public.bop_auto_emit_policy_alert is
  'Emits a policy_alert when the AI classifier gives a >= 0.85 kratom_direct + hostile_proposal verdict and the regex pass agrees. Kind follows the source (rule_filed / news_break / bop_hearing); baseline and news findings go to the review queue (0279).';
