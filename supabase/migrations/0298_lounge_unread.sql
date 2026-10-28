-- 0298_lounge_unread.sql
--
-- Lounge new-message badge (owner ask 2026-10-28). The floating Lounge button
-- shows how many messages arrived since the member last opened the Lounge.
--
--   * profiles.lounge_seen_at — when this member last opened the Lounge. Not a
--     sensitive column (it only drives the member's own badge), so it stays
--     self-writable and does NOT join guard_profiles_self_privilege.
--   * lounge_unread_count() — the badge number, read by /api/me in the same
--     round trip as the inbox + DM counts (no extra request per page). Capped
--     at 99. A member who never opened the Lounge counts the last 3 days.
--   * mark_lounge_seen() — called when the Lounge opens.
--
-- Both functions are SECURITY INVOKER: chat_messages SELECT is `to
-- authenticated` and profiles self-update is RLS'd to the caller's own row, so
-- RLS does the scoping. @mention notifications need no schema: they are
-- ordinary `notifications` rows with kind = 'mention'.
--
-- Rollback:
--   drop function if exists public.mark_lounge_seen();
--   drop function if exists public.lounge_unread_count();
--   alter table public.profiles drop column if exists lounge_seen_at;

alter table public.profiles
  add column if not exists lounge_seen_at timestamptz;

create or replace function public.lounge_unread_count()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select least(count(*), 99)::integer
    from (
      select 1
        from public.chat_messages m
       where m.room = 'lounge'
         and m.user_id <> auth.uid()
         and m.created_at > coalesce(
               (select p.lounge_seen_at from public.profiles p where p.id = auth.uid()),
               now() - interval '3 days')
       limit 100
    ) recent;
$$;

create or replace function public.mark_lounge_seen()
returns void
language sql
security invoker
set search_path = public
as $$
  update public.profiles set lounge_seen_at = now() where id = auth.uid();
$$;

revoke all on function public.lounge_unread_count() from public, anon;
revoke all on function public.mark_lounge_seen() from public, anon;
grant execute on function public.lounge_unread_count() to authenticated;
grant execute on function public.mark_lounge_seen() to authenticated;
