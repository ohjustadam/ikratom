-- ============================================================
-- 0240 — Presence: profiles.last_seen_at (owner "who's online")
-- ============================================================
-- Owner ask: an owner-only live view of who's currently active. Lightweight
-- last-seen heartbeat (not a full realtime presence channel):
--   * profiles.last_seen_at — updated by touch_last_seen(), which a client
--     heartbeat calls ~every 60s while the tab is visible.
--   * The RPC self-throttles (only writes if the stamp is >50s old) so even a
--     chatty client can't hammer the row.
--
-- Privacy: last_seen_at is on profiles, whose SELECT RLS is self-or-admin only
-- (no public/anon read) — so this adds NO public exposure. The owner widget
-- reads it admin-side and shows @username only (never real name).
--
-- Rollback:
--   drop function if exists public.touch_last_seen();
--   drop index if exists profiles_last_seen_idx;
--   alter table public.profiles drop column if exists last_seen_at;

alter table public.profiles add column if not exists last_seen_at timestamptz;

create index if not exists profiles_last_seen_idx
  on public.profiles(last_seen_at desc) where last_seen_at is not null;

create or replace function public.touch_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '50 seconds');
end;
$$;

revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;
