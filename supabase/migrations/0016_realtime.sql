-- ============================================================
-- 0016 — Enable Supabase Realtime on conversation + forum tables
-- ============================================================
-- Adds tables to the supabase_realtime publication so client subscriptions
-- receive INSERT/UPDATE/DELETE events. RLS still applies — clients only
-- receive events for rows they're allowed to see.

-- DM messages: live conversation view appends new ciphertext as it arrives
alter publication supabase_realtime add table public.dm_messages;

-- Forum posts: live thread view shows new replies as they're posted
alter publication supabase_realtime add table public.forum_posts;

-- Forum reactions: counts update live (optional but cheap)
alter publication supabase_realtime add table public.forum_reactions;

-- Notifications: bell badge updates live without needing a refresh
alter publication supabase_realtime add table public.notifications;
