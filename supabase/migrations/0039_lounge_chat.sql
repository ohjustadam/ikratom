-- ============================================================
-- 0039_lounge_chat
--
-- Live chat room ("Lounge") on the forum index. Lets users see who else
-- is around and have low-stakes back-and-forth without committing to a
-- thread reply. The "middle room" between landing and structured forum
-- discussion — community feel, not just static state lists.
--
-- Design notes:
--   * Single global room for now (room='lounge'). The column makes it
--     trivial to add per-state lounges later (room = 'state:OK' etc).
--   * 500-char hard cap — chat messages, not essays. Threads are still
--     where long-form discussion happens.
--   * Soft rate limit enforced server-side (10 msgs / 60s / user) via the
--     existing rate-limit infra; not encoded in the schema.
--   * Realtime publication so clients can subscribe to inserts/deletes.
--
-- Moderation:
--   * Same `is_admin(uid)` SECURITY DEFINER predicate used elsewhere lets
--     admins delete any message. Authors can delete their own.
--   * No edit — chat is ephemeral by design. Fix typos by sending again.
-- ============================================================

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room text not null default 'lounge',
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

-- Hot path: "give me the last N messages in room X, newest first"
create index if not exists idx_chat_messages_room_created
  on public.chat_messages (room, created_at desc);

alter table public.chat_messages enable row level security;

-- Read: any signed-in user can read any room. (We don't gate by state
-- because 'lounge' is global. When per-state rooms ship, tighten this.)
drop policy if exists "chat_select_authenticated" on public.chat_messages;
create policy "chat_select_authenticated"
  on public.chat_messages
  for select
  to authenticated
  using (true);

-- Insert: only as yourself.
drop policy if exists "chat_insert_own" on public.chat_messages;
create policy "chat_insert_own"
  on public.chat_messages
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- Delete: own messages, or admins on any.
drop policy if exists "chat_delete_own_or_admin" on public.chat_messages;
create policy "chat_delete_own_or_admin"
  on public.chat_messages
  for delete
  to authenticated
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

-- Realtime: clients subscribe to the lounge channel for live append + delete.
-- Wrapped in a DO block so re-running the migration doesn't error if the
-- table is already in the publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end$$;
