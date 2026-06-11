-- 0196_alert_recency_guard.sql — historical backfill must never sound the
-- siren (2026-06-11).
--
-- The LegiScan bulk-dataset heal inserted YEARS-old bill_actions rows; the
-- 0076 critical_action_alert() trigger fired on each INSERT regardless of
-- the action's real-world date, spawning fresh policy_alerts for 2021-2025
-- events and push-notifying users about "news" from past sessions (the
-- stale OK alert the owner caught on Pulse). The trigger checked bill
-- ACTIVITY but not action RECENCY.
--
-- This is the EXACT 0076 function body with ONE addition: the recency
-- guard at the top. Live syncs insert fresh actions and still alert in
-- real time; backfills land silently as history. 21 days is generous
-- slack for slow clerk publishing without resurrecting old sessions.
--
-- Rollback: re-apply the 0076 version of critical_action_alert().

create or replace function public.critical_action_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_match record;
  v_severity text;
  v_action_required boolean;
  v_alert_id uuid;
  v_desc_lower text;
  v_title_clean text;
begin
  -- RECENCY GUARD (0196): historical backfill is data, not breaking news.
  if new.action_date is null
     or new.action_date < (current_date - interval '21 days') then
    return new;
  end if;

  -- Look up the bill — skip if missing or inactive
  select * into v_bill from public.bills where id = new.bill_id;
  if not found then return new; end if;
  if not v_bill.active then return new; end if;

  v_desc_lower := lower(new.description);

  -- Find the highest-severity matching keyword
  select * into v_match
    from public.bill_action_keywords
   where active
     and v_desc_lower like '%' || pattern || '%'
   order by case severity when 'critical' then 3 when 'alert' then 2 else 1 end desc
   limit 1;

  -- No match → not a critical action, exit quietly
  if not found then return new; end if;

  -- Adjust severity by bill stance:
  --   anti bill + critical keyword → critical (full siren)
  --   anti bill + alert keyword    → alert
  --   pro bill  + critical keyword → alert (we still care, but it's the good guys winning)
  --   pro bill  + alert keyword    → watch
  --   neutral   + anything         → watch (informational only)
  v_severity := case
    when v_bill.kratom_relevance = 'anti'  and v_match.severity = 'critical' then 'critical'
    when v_bill.kratom_relevance = 'anti'  and v_match.severity = 'alert'    then 'alert'
    when v_bill.kratom_relevance = 'pro'   and v_match.severity = 'critical' then 'alert'
    when v_bill.kratom_relevance = 'pro'   and v_match.severity = 'alert'    then 'watch'
    else 'watch'
  end;

  -- action_required = true ONLY for anti bills (advocates need to mobilize).
  -- pro bills get notification but no auto-campaign spawn.
  v_action_required := (v_bill.kratom_relevance = 'anti'
                        and v_match.severity in ('critical', 'alert'));

  -- Clean up the title for the alert headline
  v_title_clean := v_bill.state || ' ' || v_bill.bill_number;

  -- Insert the alert. The Phase 4 trigger then fires (if action_required)
  -- and the auto-campaign chain takes over from there.
  insert into public.policy_alerts (
    kind, severity, title, body, locality, source_url, bill_id,
    action_required, moderation_status, occurs_at
  ) values (
    'bill_event',
    v_severity,
    v_title_clean || ' — ' || new.description,
    'Bill ' || v_title_clean || ' had a tracked critical action on ' ||
      to_char(new.action_date, 'YYYY-MM-DD') || ': ' || new.description ||
      coalesce(E'\n\nSource: ' || new.source, '') ||
      coalesce(E'\n\nBill: ' || v_bill.title, ''),
    coalesce(v_bill.state, 'ALL'),
    v_bill.source_url,
    v_bill.id,
    v_action_required,
    'approved',
    new.action_date::timestamptz
  )
  returning id into v_alert_id;

  -- Stamp the action row with the alert it spawned (for audit + dedupe)
  update public.bill_actions
     set alert_spawned_id = v_alert_id
   where id = new.id;

  return new;
exception
  when others then
    raise warning 'critical_action_alert failed for action %: %', new.id, sqlerrm;
    return new;
end;
$$;
