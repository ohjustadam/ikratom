-- 0321_group_post_length.sql
--
-- Group discussion posts and replies can be up to 10,000 characters (was 5,000).
-- PJ (2026-11-11) pasted a letter to an editor, rebutting a news article, into
-- his group's board and it was cut off at the limit. The forms, the server
-- actions (src/modules/coalitions/limits.ts) and these checks hold the same
-- number. Spam screening and the per-hour rate limits are unchanged.
--
-- Only widens a check, so no existing row can fail it.
--
-- Rollback (first trim or remove any post over 5,000 characters):
--   alter table public.coalition_threads drop constraint if exists coalition_threads_body_check;
--   alter table public.coalition_threads add constraint coalition_threads_body_check check (char_length(body) <= 5000);
--   alter table public.coalition_posts drop constraint if exists coalition_posts_body_check;
--   alter table public.coalition_posts add constraint coalition_posts_body_check check (char_length(body) <= 5000);

alter table public.coalition_threads drop constraint if exists coalition_threads_body_check;
alter table public.coalition_threads add constraint coalition_threads_body_check
check (char_length(body) <= 10000);

alter table public.coalition_posts drop constraint if exists coalition_posts_body_check;
alter table public.coalition_posts add constraint coalition_posts_body_check
check (char_length(body) <= 10000);
