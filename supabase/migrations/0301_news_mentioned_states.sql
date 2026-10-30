-- 0301_news_mentioned_states.sql
--
-- Every state a news story is about, not just the one it is filed under.
--
-- WHY. news_items.state is ONE state: the story's home. A Mississippi story
-- about the Ole Miss deaths that discusses Louisiana's ban in three paragraphs
-- was only ever shown, and pushed, to Mississippi. mentioned_states lists the
-- OTHER states the story names in its headline or in 3+ paragraphs of its body
-- (scripts/lib/news-state.mjs newsStatesMentioned, the same counter that moves
-- a misfiled story). The state hub, /news filter, Pulse and Brief read it to
-- show the story under each state, the article links each state, and
-- push-state-news.mjs notifies those states' members.
--
-- A text[] of 2-letter codes, not a join table: every reader filters one state
-- (`mentioned_states @> '{LA}'`), which the GIN index serves directly, and the
-- column exports to CSV as a plain list. Filled by extract-news-content.mjs
-- when a body is extracted; backfilled by scripts/retag-news-states.mjs.
--
-- Grants: a new column on an existing table inherits its table-level SELECT
-- (news_items has no column-level grants), so nothing to grant.
--
-- Rollback:
--   drop index if exists public.ix_news_items_mentioned_states;
--   alter table public.news_items drop column if exists mentioned_states;

alter table public.news_items
  add column if not exists mentioned_states text[] not null default '{}';

comment on column public.news_items.mentioned_states is
  'Other states this story is about: named in its headline or in 3+ body paragraphs. Excludes state. See 0301.';

create index if not exists ix_news_items_mentioned_states
  on public.news_items using gin (mentioned_states)
  where active = true;
