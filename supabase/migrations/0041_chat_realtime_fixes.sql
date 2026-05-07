-- ============================================================
-- 0041_chat_realtime_fixes
--
-- 1) REPLICA IDENTITY FULL on chat_messages so DELETE events carry the
--    full pre-delete row in the WAL.
--
--    Why this matters: the Lounge subscribes to postgres_changes with
--    `filter: room=eq.lounge`. With the default replica identity (PK
--    only), DELETE events only contain `id` — Realtime can't evaluate
--    the room filter, so it drops the event silently. INSERT events
--    aren't affected because the new row is always logged in full.
--
--    Cost: slightly larger WAL writes on UPDATE/DELETE. For a chat
--    table with small rows and modest volume, negligible.
--
-- 2) Index on (user_id, body, created_at) to make the "did this user
--    send the same body in the last 60s?" duplicate-detection query
--    O(log n) instead of a sequential scan.
-- ============================================================

alter table public.chat_messages replica identity full;

-- Speeds up duplicate detection inside postChatMessage. The index covers
-- the exact predicate: user_id + body + recent created_at.
create index if not exists idx_chat_messages_dup_check
  on public.chat_messages (user_id, created_at desc, body);
