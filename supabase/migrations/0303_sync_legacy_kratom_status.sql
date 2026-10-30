-- 0303_sync_legacy_kratom_status.sql
-- states.kratom_status is the legacy status column. state_status.admin_leaf_status
-- replaced it as the confirmed status (the maps, /banned and the state hubs read
-- it), but the forum state pages, /admin/legislators and the briefing generator
-- still read the old column. It had drifted for 23 states: CT, MA and TN showed
-- "legal" although all three ban kratom, and the AI state briefings repeated it.
--
-- Copy the confirmed status into the legacy column now, and on every confirm
-- from here on, so the two can't disagree again.
--
-- Rollback: drop trigger if exists state_status_sync_legacy on public.state_status;
--           drop function if exists public.sync_legacy_kratom_status();
-- (the copied values stay: they are the confirmed statuses)

create or replace function public.sync_legacy_kratom_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.admin_leaf_status is not null then
    update public.states
       set kratom_status = new.admin_leaf_status
     where abbr = new.state
       and kratom_status is distinct from new.admin_leaf_status;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_legacy_kratom_status() from public, anon, authenticated;

drop trigger if exists state_status_sync_legacy on public.state_status;
create trigger state_status_sync_legacy
  after insert or update of admin_leaf_status on public.state_status
  for each row execute function public.sync_legacy_kratom_status();

update public.states s
   set kratom_status = ss.admin_leaf_status
  from public.state_status ss
 where ss.state = s.abbr
   and ss.admin_leaf_status is not null
   and s.kratom_status is distinct from ss.admin_leaf_status;
