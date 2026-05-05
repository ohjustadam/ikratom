-- ============================================================
-- 0010 — Forum (threads + posts + reactions) + DM schema-prep
-- ============================================================
-- G1 of the community layer: public state-anchored forum threads,
-- one-level-deep replies (Reddit-flat), upvote + "helpful" reactions.
--
-- Also adds public_key column to profiles for the upcoming E2E DM build.

-- ============================================================
-- Profiles: public key for future E2E DMs
-- ============================================================
alter table public.profiles
  add column if not exists public_key text;          -- Curve25519, base64

-- ============================================================
-- Forum threads
-- ============================================================
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  state text references public.states(abbr),         -- null = federal / multistate
  locality text,                                     -- "Tulsa, OK" for hyper-local; null for state-wide
  author_id uuid references auth.users(id) on delete set null,
  author_state text,                                 -- denormalized for "From [state]" badge
  title text not null,
  body text,                                         -- markdown supported
  tag text not null default 'general',               -- 'legislation' | 'news' | 'event' | 'meetup' | 'market' | 'general'
  residents_only boolean not null default false,     -- if true, only locals + leaders/admins can reply
  pinned boolean not null default false,             -- admin-pinned at top
  locked boolean not null default false,             -- admin-locked (no new replies)
  post_count integer not null default 0,             -- denormalized
  upvote_count integer not null default 0,
  helpful_count integer not null default 0,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_threads_state_idx on public.forum_threads(state);
create index if not exists forum_threads_tag_idx on public.forum_threads(tag);
create index if not exists forum_threads_activity_idx on public.forum_threads(last_activity_at desc);

-- ============================================================
-- Forum posts (replies — one level deep)
-- ============================================================
create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  parent_post_id uuid references public.forum_posts(id) on delete cascade,  -- null = top-level reply
  author_id uuid references auth.users(id) on delete set null,
  author_state text,                                 -- denormalized for badge
  body text not null,
  upvote_count integer not null default 0,
  helpful_count integer not null default 0,
  deleted_at timestamptz,                            -- soft delete
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists forum_posts_thread_idx on public.forum_posts(thread_id);
create index if not exists forum_posts_parent_idx on public.forum_posts(parent_post_id);

-- ============================================================
-- Forum reactions (upvote, helpful) — one row per user-target-reaction
-- ============================================================
create table if not exists public.forum_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,                         -- 'thread' | 'post'
  target_id uuid not null,
  reaction text not null,                            -- 'upvote' | 'helpful'
  created_at timestamptz not null default now(),
  unique (user_id, target_type, target_id, reaction)
);

create index if not exists forum_reactions_target_idx
  on public.forum_reactions(target_type, target_id);

-- ============================================================
-- Triggers: maintain denormalized counts + last_activity_at
-- ============================================================

-- Update last_activity_at + post_count on new post
create or replace function public.trg_forum_post_inserted()
returns trigger language plpgsql as $$
begin
  update public.forum_threads
    set post_count = post_count + 1,
        last_activity_at = now(),
        updated_at = now()
    where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists forum_post_inserted on public.forum_posts;
create trigger forum_post_inserted
  after insert on public.forum_posts
  for each row execute function public.trg_forum_post_inserted();

-- Decrement post_count on soft-delete
create or replace function public.trg_forum_post_softdeleted()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.forum_threads
      set post_count = greatest(0, post_count - 1)
      where id = new.thread_id;
  end if;
  return new;
end;
$$;

drop trigger if exists forum_post_softdeleted on public.forum_posts;
create trigger forum_post_softdeleted
  after update on public.forum_posts
  for each row execute function public.trg_forum_post_softdeleted();

-- Reaction counts: increment on insert, decrement on delete
create or replace function public.trg_forum_reaction_changed()
returns trigger language plpgsql as $$
declare
  v_delta integer := case tg_op when 'INSERT' then 1 when 'DELETE' then -1 else 0 end;
  v_target_id uuid := case tg_op when 'INSERT' then new.target_id when 'DELETE' then old.target_id end;
  v_target_type text := case tg_op when 'INSERT' then new.target_type when 'DELETE' then old.target_type end;
  v_reaction text := case tg_op when 'INSERT' then new.reaction when 'DELETE' then old.reaction end;
begin
  if v_target_type = 'thread' then
    if v_reaction = 'upvote' then
      update public.forum_threads set upvote_count = greatest(0, upvote_count + v_delta) where id = v_target_id;
    elsif v_reaction = 'helpful' then
      update public.forum_threads set helpful_count = greatest(0, helpful_count + v_delta) where id = v_target_id;
    end if;
  elsif v_target_type = 'post' then
    if v_reaction = 'upvote' then
      update public.forum_posts set upvote_count = greatest(0, upvote_count + v_delta) where id = v_target_id;
    elsif v_reaction = 'helpful' then
      update public.forum_posts set helpful_count = greatest(0, helpful_count + v_delta) where id = v_target_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists forum_reaction_changed on public.forum_reactions;
create trigger forum_reaction_changed
  after insert or delete on public.forum_reactions
  for each row execute function public.trg_forum_reaction_changed();

-- ============================================================
-- RLS
-- ============================================================
alter table public.forum_threads enable row level security;
alter table public.forum_posts enable row level security;
alter table public.forum_reactions enable row level security;

-- Threads: public read (everyone — including signed-out users — can browse)
drop policy if exists "forum_threads_public_read" on public.forum_threads;
create policy "forum_threads_public_read" on public.forum_threads
  for select using (true);

-- Threads: signed-in user can insert (author_id will be enforced below)
drop policy if exists "forum_threads_authed_insert" on public.forum_threads;
create policy "forum_threads_authed_insert" on public.forum_threads
  for insert with check (auth.uid() = author_id);

-- Threads: author can update their own; admins+leaders update any
drop policy if exists "forum_threads_author_update" on public.forum_threads;
create policy "forum_threads_author_update" on public.forum_threads
  for update using (auth.uid() = author_id);

drop policy if exists "forum_threads_creator_update" on public.forum_threads;
create policy "forum_threads_creator_update" on public.forum_threads
  for update using (public.is_campaign_creator(auth.uid()));

-- Threads: author can delete their own; admins+leaders any
drop policy if exists "forum_threads_author_delete" on public.forum_threads;
create policy "forum_threads_author_delete" on public.forum_threads
  for delete using (auth.uid() = author_id or public.is_campaign_creator(auth.uid()));

-- Posts: public read (excluding soft-deleted is enforced server-side)
drop policy if exists "forum_posts_public_read" on public.forum_posts;
create policy "forum_posts_public_read" on public.forum_posts
  for select using (true);

-- Posts: signed-in user can insert their own
drop policy if exists "forum_posts_authed_insert" on public.forum_posts;
create policy "forum_posts_authed_insert" on public.forum_posts
  for insert with check (auth.uid() = author_id);

-- Posts: author can update their own; admins/leaders any
drop policy if exists "forum_posts_author_update" on public.forum_posts;
create policy "forum_posts_author_update" on public.forum_posts
  for update using (auth.uid() = author_id);

drop policy if exists "forum_posts_creator_update" on public.forum_posts;
create policy "forum_posts_creator_update" on public.forum_posts
  for update using (public.is_campaign_creator(auth.uid()));

-- Reactions: user manages their own
drop policy if exists "forum_reactions_self_rw" on public.forum_reactions;
create policy "forum_reactions_self_rw" on public.forum_reactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "forum_reactions_public_read" on public.forum_reactions;
create policy "forum_reactions_public_read" on public.forum_reactions
  for select using (true);
