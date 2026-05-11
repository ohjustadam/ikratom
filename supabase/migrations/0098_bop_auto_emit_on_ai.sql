-- ============================================================
-- 0098_bop_auto_emit_on_ai
--
-- Closes the time-sensitive loop on the BoP pipeline. Currently every
-- finding requires admin button-click to promote to a policy_alert
-- (which fans out to advocates via /pulse + dashboard + push). For
-- hostile kratom proposals that's too slow — those need to reach
-- advocates within minutes, not whenever admin happens to log in.
--
-- This trigger auto-emits a policy_alert when ALL of:
--   1. AI relevance = 'kratom_direct'
--   2. AI severity   = 'hostile_proposal'
--   3. AI confidence >= 0.85
--   4. regex relevance ALSO says 'kratom_direct' (two-signal agreement)
--   5. No alert has been emitted from this finding yet
--
-- Fires on UPDATE when ai_classified_at flips from null to a value —
-- i.e. the moment the AI classifier produces a verdict on a finding.
-- Admin can still manually trigger emit via the UI for findings that
-- don't meet the auto-bar (e.g. confidence 0.7).
--
-- Conservative thresholds: false-positive auto-alerts would spam every
-- advocate's phone. 0.85 + two-signal-agreement keeps the bar high
-- enough that auto-emit is for the most-confident cases only.
-- ============================================================

create or replace function public.bop_auto_emit_policy_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alert_id uuid;
  v_state text := new.state;
  v_title text;
  v_body text;
begin
  -- Only fire on the transition where AI classification was just set.
  if new.ai_classified_at is null then return new; end if;
  if tg_op = 'UPDATE' and old.ai_classified_at is not null then
    return new; -- already had a verdict; nothing changed re emit
  end if;

  -- Confidence + double-signal gates.
  if new.ai_relevance is distinct from 'kratom_direct' then return new; end if;
  if new.ai_severity is distinct from 'hostile_proposal' then return new; end if;
  if coalesce(new.ai_confidence, 0) < 0.85 then return new; end if;
  if new.classified_relevance is distinct from 'kratom_direct' then return new; end if;
  if new.alert_emitted_at is not null then return new; end if;

  -- Build the alert body. Includes AI reasoning + source link so the
  -- advocate sees WHY this is hostile and can verify directly.
  v_title := '🚨 ' || v_state || ' BoP: hostile kratom rule proposed — ' || left(coalesce(new.title, ''), 120);
  v_body := 'Auto-detected via the BoP scraper + AI classifier (confidence '
         || round(new.ai_confidence * 100) || '%).'
         || E'\n\n'
         || 'What the AI found: ' || coalesce(new.ai_reasoning, '(no reasoning recorded)')
         || E'\n\n'
         || 'Source: ' || coalesce(new.url, '(no direct URL)')
         || E'\n\n'
         || 'This alert was auto-emitted because the AI classifier was highly confident this is hostile to kratom. '
         || 'An admin can dismiss it from /admin/bop-monitor if it''s a false positive.';

  insert into public.policy_alerts (
    kind, severity, title, body, locality, source_url,
    moderation_status, action_required
  ) values (
    'bop_rule_proposal',
    'alert', -- not 'critical' — that's reserved for confirmed-enacted
    left(v_title, 300),
    v_body,
    v_state,
    new.url,
    'approved',
    true
  )
  returning id into v_alert_id;

  -- Link the alert back to the finding so admin UI can show the
  -- "alert emitted" chip + jump straight to it.
  update public.bop_findings
     set alert_emitted_at = now(),
         alert_id = v_alert_id
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_bop_auto_emit_policy_alert on public.bop_findings;
create trigger trg_bop_auto_emit_policy_alert
  after update of ai_classified_at on public.bop_findings
  for each row
  execute function public.bop_auto_emit_policy_alert();

comment on function public.bop_auto_emit_policy_alert is
  'Auto-emits a policy_alert when the AI classifier produces a high-confidence (>= 0.85) kratom_direct + hostile_proposal verdict and the regex pass agrees. Two-signal-agreement + admin override keeps the false-positive surface small.';
