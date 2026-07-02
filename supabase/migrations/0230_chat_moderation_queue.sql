-- 0230: chat_moderation_queue — AI moderation hold queue for the Lounge (D4)
--
-- Anti-weaponization D4: the AI router's moderation task was unlocked (#599)
-- but never INVOKED — postChatMessage ran only non-AI gates (flood/URL/mute/
-- rate/dupe). This adds the AI safety net. Design: SCREEN BEFORE INSERT and
-- FAIL OPEN — a clearly-abusive message (harassment/hate/threat/sexual/spam) is
-- diverted here instead of into chat_messages (so it never broadcasts over
-- realtime), and an admin releases or dismisses it. Anything clean, low-
-- confidence, or unscreenable (AI down) posts normally. Moderation targets
-- ABUSE ONLY — never viewpoint/stance (the lounge is community speech; stance
-- screening applies only to OUTBOUND campaign email, PR3).
--
-- Rollback: drop table chat_moderation_queue.

create table if not exists public.chat_moderation_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  room text not null default 'lounge',
  body text not null,
  category text,                       -- harassment | hate | threat | sexual | spam | other
  reason text,                         -- one-line AI justification (shown to admin)
  ai_confidence numeric,               -- 0..1
  status text not null default 'pending' check (status in ('pending','released','dismissed')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_modq_pending
  on public.chat_moderation_queue (created_at desc) where status = 'pending';

alter table public.chat_moderation_queue enable row level security;

-- Admin-only read + update. Inserts + releases happen via the service-role
-- client in server actions (bypasses RLS), so no insert policy is granted to
-- authenticated/anon — a user can't read or seed the queue directly.
drop policy if exists "chat_modq_admin_select" on public.chat_moderation_queue;
create policy "chat_modq_admin_select"
  on public.chat_moderation_queue for select
  to authenticated
  using (public.is_admin(auth.uid()));

drop policy if exists "chat_modq_admin_update" on public.chat_moderation_queue;
create policy "chat_modq_admin_update"
  on public.chat_moderation_queue for update
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
