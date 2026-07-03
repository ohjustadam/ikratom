-- 0231_campaign_notify_suppress
--
-- Intent: stop auto-resolve / backlog-clearing from SPAMMING users with a
-- new-campaign notification per approved row. A deliberate single manual approve
-- still notifies; the bulk + autonomous resolvers now set suppress_notify=true so
-- clearing the queue is silent. (Dedup across outlets is fixed separately in the
-- resolver so we don't approve the same story N times in the first place.)
--
-- Rollback:
--   drop the `and not coalesce(new.suppress_notify, false)` clause from
--   trg_campaign_notify(); alter table public.campaigns drop column suppress_notify;

alter table public.campaigns
  add column if not exists suppress_notify boolean not null default false;

-- Re-declare the notify trigger fn with the suppression guard. Unchanged except
-- for the extra `and not coalesce(new.suppress_notify, false)` condition.
create or replace function public.trg_campaign_notify()
returns trigger
language plpgsql
as $$
begin
  if new.active
     and (tg_op = 'INSERT' or old.active = false)
     and not coalesce(new.suppress_notify, false)
  then
    perform public.notify_users_for_campaign(new.id);
  end if;
  return new;
end;
$$;
