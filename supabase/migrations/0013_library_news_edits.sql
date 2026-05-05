-- ============================================================
-- 0013 — Forum edits + Library + News scraping schema
-- ============================================================

-- Forum: track edits (we also kept the soft-delete from 0010)
alter table public.forum_threads
  add column if not exists edited_at timestamptz;
alter table public.forum_posts
  add column if not exists edited_at timestamptz;

-- ============================================================
-- Library: videos, books, articles, transcripts
-- Type-tagged so one table holds everything; UI dispatches per type.
-- ============================================================
create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  type text not null,                          -- 'video' | 'audio' | 'book' | 'article' | 'document'
  title text not null,
  description text,
  url text,                                    -- canonical source URL (YouTube, podcast, etc.)
  embed_html text,                             -- pre-validated iframe HTML (for video embeds)
  cover_image_url text,
  -- For books / long-form: full text + AI summary
  full_text text,
  summary text,
  -- For audio/video: duration + transcript
  duration_seconds integer,
  transcript text,
  -- Metadata
  author text,                                 -- creator/author name
  source_org text,                             -- "AKA", "iKratom Originals", etc. — null = community
  language text not null default 'en',
  published_at date,
  tags text[] not null default '{}',           -- ['kcpa', 'medical', 'history', 'beginners', ...]
  kratom_relevance text default 'high',        -- 'high' | 'medium' | 'low'
  -- Curation
  added_by uuid references auth.users(id) on delete set null,
  featured boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists library_items_type_idx on public.library_items(type);
create index if not exists library_items_active_featured_idx on public.library_items(active, featured) where active = true;
create index if not exists library_items_tags_idx on public.library_items using gin(tags);

alter table public.library_items enable row level security;

drop policy if exists "library_public_read" on public.library_items;
create policy "library_public_read" on public.library_items
  for select using (active = true);

-- Admins/leaders can write
drop policy if exists "library_creator_write" on public.library_items;
create policy "library_creator_write" on public.library_items
  for all
  using (public.is_campaign_creator(auth.uid()))
  with check (public.is_campaign_creator(auth.uid()));

-- ============================================================
-- News: AI-scraped per-state kratom news
-- ============================================================
create table if not exists public.news_items (
  id uuid primary key default gen_random_uuid(),
  state text references public.states(abbr),  -- null = federal/national
  title text not null,
  summary text,                                 -- AI-summarized
  url text not null,                            -- canonical source URL
  source_name text,                             -- "AP", "Reuters", "Tulsa World", etc.
  published_at timestamptz,
  scraped_at timestamptz not null default now(),
  -- AI scoring
  kratom_topic text,                            -- 'legislation' | 'science' | 'business' | 'enforcement' | 'culture'
  ai_relevance_score numeric(3,2) default 0.5,  -- 0.00 to 1.00 — higher = more relevant
  -- Curation
  active boolean not null default true,
  flagged_by uuid references auth.users(id) on delete set null,
  flag_reason text
);

create unique index if not exists news_items_url_uniq on public.news_items(url);
create index if not exists news_items_state_published_idx on public.news_items(state, published_at desc);
create index if not exists news_items_relevance_idx on public.news_items(ai_relevance_score desc);

alter table public.news_items enable row level security;

drop policy if exists "news_public_read" on public.news_items;
create policy "news_public_read" on public.news_items
  for select using (active = true);

drop policy if exists "news_creator_write" on public.news_items;
create policy "news_creator_write" on public.news_items
  for all
  using (public.is_campaign_creator(auth.uid()))
  with check (public.is_campaign_creator(auth.uid()));
