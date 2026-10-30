-- 0304_bop_admin_alert_once.sql
--
-- WHY (owner report 2026-10-30): admins got 30 "BoP: kratom mention in
-- agenda" notifications in two days, mostly repeats of a handful of press
-- releases. notify_admins_on_bop_finding (0094) had five gaps:
--   1. It fired on EVERY update of ai_relevance/ai_severity/ai_confidence, so
--      each re-classification of a finding pinged again (10-29: 9 re-queued
--      findings re-alerted at once).
--   2. It pinged once on insert (regex only) and again when the AI agreed, so
--      every new finding alerted twice (UT 10-30, 10:18 and 10:22).
--   3. It ignored is_baseline, so a new source's backlog (MO AG's past press
--      releases, a governor's August order) alerted as if new.
--   4. It ignored reviewed_relevance, so a row an admin had marked unrelated
--      still alerted, and so did its URL twin.
--   5. The same story re-found as a new row (a URL-less twin, or a title whose
--      quotes arrived as &#8220; one walk and as real quotes the next)
--      alerted again.
--   6. It labelled everything "kratom mention in agenda", including press
--      releases and rule bulletins.
--
-- NOW: a finding pings the admins at most once, ever (admin_notified_at), and
-- only when the AI says kratom_direct with confidence >= 0.7. It stays silent
-- for baseline rows, for rows a human has reviewed, and when the same story
-- (same state, same title once entities and punctuation are stripped, a
-- compatible URL) has already pinged. The title says what the document is.
-- The /admin/bop-monitor page still lists every finding; only the ping
-- changed. The policy-alert trigger (bop_auto_emit_policy_alert) is untouched.
--
-- ROLLBACK:
--   drop trigger if exists trg_bop_finding_admin_notify on public.bop_findings;
--   -- re-run the function body and AFTER trigger from 0094_bop_ai_classifier.sql
--   alter table public.bop_findings drop column if exists admin_notified_at;

alter table public.bop_findings
  add column if not exists admin_notified_at timestamptz;

comment on column public.bop_findings.admin_notified_at is
  'When the admins were pinged about this finding (or when it was ruled not worth a ping). Set once; a finding never pings twice (0304).';

-- Every finding the old trigger already had its chance at is settled, so
-- re-classifying it later never pings. Rows still waiting for their first AI
-- pass (not baseline, not reviewed) stay eligible.
update public.bop_findings
   set admin_notified_at = coalesce(alert_emitted_at, ai_classified_at, found_at)
 where admin_notified_at is null
   and (ai_classified_at is not null or is_baseline or reviewed_relevance is not null);

create or replace function public.notify_admins_on_bop_finding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src record;
  v_what text;
  v_key text;
begin
  if new.admin_notified_at is not null then return new; end if;
  -- Only once the AI agrees. The regex-only ping before the AI pass is what
  -- doubled every alert; the AI pass follows within the hour.
  if new.ai_relevance is distinct from 'kratom_direct'
     or coalesce(new.ai_confidence, 0) < 0.7 then
    return new;
  end if;

  -- From here the finding is settled either way: it pings now or never.
  new.admin_notified_at := now();

  -- A human already ruled on it, or it is a new source's backlog.
  if new.reviewed_relevance is not null or new.is_baseline then return new; end if;

  -- The same story already pinged in this state.
  v_key := left(regexp_replace(regexp_replace(lower(coalesce(new.title, '')),
             '&#?[a-z0-9]+;', '', 'g'), '[^a-z0-9]+', '', 'g'), 120);
  if v_key <> '' and exists (
    select 1
      from public.bop_findings f
     where f.state = new.state
       and f.id <> new.id
       and f.admin_notified_at is not null
       and (f.url is null or new.url is null or f.url = new.url)
       and left(regexp_replace(regexp_replace(lower(coalesce(f.title, '')),
             '&#?[a-z0-9]+;', '', 'g'), '[^a-z0-9]+', '', 'g'), 120) = v_key
  ) then
    return new;
  end if;

  select board_name, surface, kind into v_src
    from public.bop_sources where id = new.source_id;
  v_what := case
    when v_src.kind = 'news' or v_src.surface ~* '(news|press)' then 'news release'
    when v_src.kind in ('rules', 'rule_proposal')
      or v_src.surface ~* '(rule|bulletin|register)' then 'rule notice'
    when v_src.surface ~* '(agenda|meeting|minutes)' then 'meeting document'
    else 'state document'
  end;

  insert into public.notifications (user_id, kind, title, body, link)
  select p.id,
         'bop_finding_direct',
         case when coalesce(new.ai_severity, new.classified_severity) = 'hostile_proposal'
              then '🚨 ' || new.state || ': possible anti-kratom action in a ' || v_what
              else '⚠ ' || new.state || ': kratom in a ' || v_what
         end,
         left(coalesce(v_src.board_name || ' · ', '') || coalesce(new.title, ''), 240),
         '/admin/bop-monitor'
    from public.profiles p
   where p.is_admin = true or p.is_owner = true
  on conflict do nothing;

  return new;
end;
$$;

revoke execute on function public.notify_admins_on_bop_finding() from public, anon, authenticated;

-- BEFORE, so the trigger can stamp admin_notified_at on the row itself.
drop trigger if exists trg_bop_finding_admin_notify on public.bop_findings;
create trigger trg_bop_finding_admin_notify
  before insert or update of ai_relevance, ai_severity, ai_confidence
  on public.bop_findings
  for each row
  execute function public.notify_admins_on_bop_finding();
