-- 0309: groups are for advocacy, not selling (owner, 2026-11-03).
--
-- r/kratom's moderators won't promote a platform with groups that promote
-- vendors. Public groups are listed to visitors, and nothing screened a
-- group's name or description. The server actions now refuse sales wording,
-- outside links and contact details (src/modules/coalitions/vendor-screen.ts),
-- but the coalitions UPDATE policy lets a group's owner write the row through
-- the API directly, so the same rule lives here too. Keep the two in step.
--
-- Covers name, description and featured_note (the organizer's note on the
-- group action). Fires only when one of them is written, so existing rows are not
-- re-judged until someone edits them. Both live groups pass (checked
-- 2026-11-03). Rollback:
--   drop trigger if exists coalition_vendor_guard on public.coalitions;
--   drop function if exists public.coalition_vendor_guard();

create or replace function public.coalition_vendor_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t text := coalesce(new.name, '') || ' ' || coalesce(new.description, '') || ' ' || coalesce(new.featured_note, '');
begin
  if t ~* '\m(coupons?|promo codes?|discount codes?|use (my |our )?code|free shipping|for sale|buy now|order now|shop now|wholesale|price list)\M'
     or t ~* '\m[0-9]{1,2} ?% off([^a-z-]|$)' then
    raise exception 'Groups are for advocacy, not selling.' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from regexp_matches(t, 'https?://([a-z0-9.-]+)', 'gi') as m(parts)
    where not (lower(m.parts[1]) ~ '(\.gov|\.edu|(^|\.)ikratom\.org)$')
  ) then
    raise exception 'A group''s name and description can only link to .gov or .edu sites.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.coalition_vendor_guard() from public, anon, authenticated;

drop trigger if exists coalition_vendor_guard on public.coalitions;
create trigger coalition_vendor_guard
  before insert or update of name, description, featured_note on public.coalitions
  for each row execute function public.coalition_vendor_guard();
