-- 0336_lounge_prefs_and_reactions.sql
--
-- WHY (B8 phase 1, owner ask 2026-11-25): members asked for their own Lounge
-- controls. Two flat tables, no new service:
--
--   * lounge_prefs: one row per member. "Keep chat open when I change pages"
--     plus the reading-comfort choices (text size, easy-read font, high
--     contrast, color theme), saved to the account so they follow the member
--     to another device. Window position and size stay per device, in the
--     browser. Self only: nobody else can read or write a member's row.
--   * chat_reactions: quick reactions on Lounge messages. One row per
--     (message, member, emoji). Readable by signed-in members only, exactly
--     like chat_messages (signed-out visitors still see nothing). The emoji
--     list is fixed here and in src/lib/chat-reactions.ts (a test holds the two
--     to the same list). A muted member can't react, as they can't post.
--
-- Writes go through server actions that re-check the user and rate-limit
-- (src/modules/chat/prefs-actions.ts, reaction-actions.ts); RLS is the floor.
-- Explicit GRANTs: new public tables get no default grants after 2026-10-30.
-- REPLICA IDENTITY FULL on chat_reactions so a DELETE event carries `room`
-- and the realtime filter `room=eq.lounge` can match it (see 0041).
--
-- Rollback:
--   alter publication supabase_realtime drop table public.chat_reactions;
--   drop table if exists public.chat_reactions;
--   drop table if exists public.lounge_prefs;

-- ── lounge_prefs ──────────────────────────────────────────────────────────
create table if not exists public.lounge_prefs (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  keep_open     boolean  not null default false,
  text_size     smallint not null default 0 check (text_size between 0 and 4),
  easy_font     boolean  not null default false,
  high_contrast boolean  not null default false,
  theme         text     not null default 'forest'
                check (theme in ('forest', 'ocean', 'paper', 'dusk')),
  updated_at    timestamptz not null default now()
);

comment on table public.lounge_prefs is
  'Lounge chat settings per member (keep open across pages, reading comfort). Self only. Mig 0336.';

alter table public.lounge_prefs enable row level security;

drop policy if exists "lounge_prefs: self read" on public.lounge_prefs;
create policy "lounge_prefs: self read" on public.lounge_prefs
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "lounge_prefs: self insert" on public.lounge_prefs;
create policy "lounge_prefs: self insert" on public.lounge_prefs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "lounge_prefs: self update" on public.lounge_prefs;
create policy "lounge_prefs: self update" on public.lounge_prefs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.lounge_prefs from public, anon, authenticated;
grant select, insert, update on public.lounge_prefs to authenticated;
grant all on public.lounge_prefs to service_role;

-- ── chat_reactions ────────────────────────────────────────────────────────
create table if not exists public.chat_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '❤️', '😂', '🙏', '💪', '😮')),
  room       text not null default 'lounge' check (room = 'lounge'),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

comment on table public.chat_reactions is
  'Quick reactions on Lounge messages. Signed-in read, own write. Mig 0336.';

alter table public.chat_reactions replica identity full;
alter table public.chat_reactions enable row level security;

drop policy if exists "chat_reactions: members read" on public.chat_reactions;
create policy "chat_reactions: members read" on public.chat_reactions
  for select to authenticated
  using (true);

-- Only as yourself, only on a Lounge message, and not while muted.
drop policy if exists "chat_reactions: react as self" on public.chat_reactions;
create policy "chat_reactions: react as self" on public.chat_reactions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.chat_messages m
       where m.id = message_id and m.room = 'lounge'
    )
    and not exists (
      select 1 from public.profiles p
       where p.id = (select auth.uid())
         and p.chat_muted_until is not null
         and p.chat_muted_until > now()
    )
  );

drop policy if exists "chat_reactions: remove own" on public.chat_reactions;
create policy "chat_reactions: remove own" on public.chat_reactions
  for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.chat_reactions from public, anon, authenticated;
grant select, insert, delete on public.chat_reactions to authenticated;
grant all on public.chat_reactions to service_role;

-- The primary key leads with message_id, which serves "reactions for these
-- messages"; a member's own reactions are found by the cascade from profiles.
create index if not exists ix_chat_reactions_user
  on public.chat_reactions (user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reactions'
  ) then
    execute 'alter publication supabase_realtime add table public.chat_reactions';
  end if;
end$$;
