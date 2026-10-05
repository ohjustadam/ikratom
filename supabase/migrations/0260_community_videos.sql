-- ============================================================
-- 0260_community_videos
--
-- Mirror kratom organisations' and creators' YouTube channels on /videos.
-- Owner ask 2026-10-02: show their videos on iKratom while likes and
-- subscriptions still go to the creator's real channel.
--
-- A channel is just an external_communities row with category 'youtube'
-- (already allowed by 0072), so it is managed in /admin/external-communities
-- and listed on /communities like any other. Archiving the row hides every
-- video from that channel at once.
--
-- scripts/sync-community-videos.mjs fills community_videos from YouTube's
-- keyless RSS feed. Video bytes and thumbnails stream from YouTube's own CDN:
-- zero Supabase storage and zero egress beyond these small metadata rows.
--
-- Rollback:
--   drop table if exists public.community_videos;
--   alter table public.external_communities drop column if exists youtube_channel_id;
--   delete from public.external_communities where category = 'youtube' and created_by is null;
-- ============================================================

alter table public.external_communities
  add column if not exists youtube_channel_id text;

do $$ begin
  alter table public.external_communities
    add constraint external_communities_yt_channel_chk
    check (youtube_channel_id is null or youtube_channel_id ~ '^UC[A-Za-z0-9_-]{22}$');
exception when duplicate_object then null; end $$;

create table if not exists public.community_videos (
  video_id text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  community_id uuid not null references public.external_communities(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  description text check (description is null or char_length(description) <= 1000),
  published_at timestamptz not null,
  -- Upcoming live stream / premiere: shown under "Live soon" until it starts.
  is_upcoming boolean not null default false,
  scheduled_start_at timestamptz,
  -- Per-video moderation without touching the channel.
  hidden boolean not null default false,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_community_videos_feed
  on public.community_videos (hidden, published_at desc);
create index if not exists ix_community_videos_channel
  on public.community_videos (community_id, published_at desc);

alter table public.community_videos enable row level security;

-- Public reads visible videos whose channel is active. Writes are service-role
-- (the sync script) or admin.
drop policy if exists community_videos_read_visible on public.community_videos;
create policy community_videos_read_visible
  on public.community_videos
  for select
  to public
  using (
    hidden = false
    and exists (
      select 1 from public.external_communities c
      where c.id = community_videos.community_id and c.is_active = true
    )
  );

drop policy if exists community_videos_admin_all on public.community_videos;
create policy community_videos_admin_all
  on public.community_videos
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Seed: national organisations AND independent creators, so no single org is
-- favoured. /videos orders by newest upload, never by org. Archive any row in
-- /admin/external-communities to drop its channel.
insert into public.external_communities (category, name, href, description, sort_order, youtube_channel_id)
select v.category, v.name, v.href, v.description, v.sort_order, v.channel_id
from (values
  ('youtube', 'American Kratom Association', 'https://www.youtube.com/@americankratomassociation', 'National consumer advocacy org: legislative updates and hearing coverage.', 10, 'UCId1uLrirJKFvez22RIl3_w'),
  ('youtube', 'Global Kratom Coalition', 'https://www.youtube.com/@GlobalKratomCoalition', 'Coalition channel: regulation, 7-OH and policy explainers.', 20, 'UCQoNymER0S_3b0R07fKg_6A'),
  ('youtube', 'Botanical Education Alliance', 'https://www.youtube.com/@botanicaleducationalliance5109', 'Education alliance archive: expert testimony and explainers.', 30, 'UCUd2pQX0zsv0-XN9xES7snw'),
  ('youtube', 'Kratom Science', 'https://www.youtube.com/@kratomscience9941', 'Video wing of KratomScience.com: news and research coverage.', 40, 'UC7VH1i9LHhCHl0aHEqKF9ag'),
  ('youtube', 'Kratom Real Talk', 'https://www.youtube.com/@KratomRealTalk', 'Independent show: news breakdowns and advocate interviews.', 50, 'UC5kTGMie3zyHk4HH8i8zVwA'),
  ('youtube', 'The Kratom Advocacy Podcast', 'https://www.youtube.com/@KratomPod', 'Independent podcast: conversations with advocates and researchers.', 60, 'UCn4QqiNXXTWBaOiQnfsf6iQ'),
  ('youtube', 'Kratom and Botanical Advocacy Network', 'https://www.youtube.com/@KratomBotanicalAdvocacyNetwork', 'Advocacy network podcast and collaborations.', 70, 'UC-JQifm3hcFsEc9EGQbq4Pw')
) as v(category, name, href, description, sort_order, channel_id)
where not exists (
  select 1 from public.external_communities e
  where e.youtube_channel_id = v.channel_id or e.href = v.href
);

comment on table public.community_videos is
  'YouTube videos mirrored from external_communities rows with category=youtube. Filled by scripts/sync-community-videos.mjs (keyless RSS). Played via youtube-nocookie embeds; likes/subscribes go to the real channel.';
