-- ============================================================
-- 0092_bop_finding_admin_notify
--
-- The BoP scraper system has been silent for admins — findings sit in
-- /admin/bop-monitor until someone happens to look. This trigger
-- closes that loop: the moment a kratom_direct finding lands in
-- bop_findings, every admin gets an in-app notification.
--
-- (The /bop-watch public page also surfaces direct findings without
-- needing admin promotion, but admins still need to triage and decide
-- whether to emit a policy_alert which fans out to all advocates.)
-- ============================================================

create or replace function public.notify_admins_on_bop_finding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_title text;
  v_severity text;
begin
  -- Only fire on direct kratom findings. Adjacent + unrelated stay quiet.
  if new.classified_relevance is distinct from 'kratom_direct' then
    return new;
  end if;

  v_state := new.state;
  v_severity := new.classified_severity;
  v_title := case
    when v_severity = 'hostile_proposal' then
      '🚨 ' || v_state || ' BoP: hostile kratom rule detected'
    else
      '⚠ ' || v_state || ' BoP: kratom mention in agenda'
  end;

  -- Fan out to every admin + owner. Insert ignores duplicates per
  -- (user_id, kind, link) so re-firing on a re-classified row is safe.
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

drop trigger if exists trg_bop_finding_admin_notify on public.bop_findings;
create trigger trg_bop_finding_admin_notify
  after insert on public.bop_findings
  for each row
  execute function public.notify_admins_on_bop_finding();

comment on function public.notify_admins_on_bop_finding is
  'Fires in-app notifications to admins + owner when a kratom_direct BoP finding is inserted. Adjacent + unrelated findings stay silent.';
