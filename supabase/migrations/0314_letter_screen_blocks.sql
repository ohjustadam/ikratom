-- 0314_letter_screen_blocks.sql
-- A private record that the letter screen refused someone (gap G6 from the
-- r/kratom work). A group probing for a way to send a ban letter left no trace:
-- the screen said no and nobody could see it happen.
--
-- Who, why and when only. The letter itself is never stored. The app writes one
-- row per member, reason and hour (the composer re-checks as they type), and
-- scripts/prune-retention.mjs keeps 90 days. /admin/abuse-signals reads it with
-- the service role after its permission check; the owner is the only member who
-- can read it directly.
--
-- Rollback:
--   drop table if exists public.letter_screen_blocks;

create table public.letter_screen_blocks (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null check (category in ('threat', 'bans_natural_kratom')),
  created_at timestamptz not null default now()
);

create index letter_screen_blocks_created_idx on public.letter_screen_blocks (created_at desc);

alter table public.letter_screen_blocks enable row level security;

create policy "letter_screen_blocks_owner_read" on public.letter_screen_blocks
  for select to authenticated
  using (public.is_owner((select auth.uid())));

revoke all on table public.letter_screen_blocks from public, anon, authenticated;
grant select on table public.letter_screen_blocks to authenticated;
grant select, insert, delete on table public.letter_screen_blocks to service_role;
