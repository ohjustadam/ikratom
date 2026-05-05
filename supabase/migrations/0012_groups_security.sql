-- ============================================================
-- 0012 — Group rooms + security hardening (G3 + G4)
-- ============================================================
-- Adds: group conversations, member roles, blocklist, DM rate limiting,
-- key-change detection, admin audit log.

-- ============================================================
-- G3: Group conversations
-- ============================================================
alter table public.dm_conversations
  add column if not exists is_group boolean not null default false,
  add column if not exists name text,
  add column if not exists description text,
  add column if not exists created_by uuid references auth.users(id) on delete set null;

alter table public.dm_participants
  add column if not exists role text not null default 'member',  -- 'owner' | 'admin' | 'member'
  -- Snapshot of the public key we encrypted the session key against, for
  -- key-change detection. If profiles.public_key later differs, warn the user.
  add column if not exists pubkey_at_join text;

-- ============================================================
-- G4: Block list — mutual hide between two users
-- ============================================================
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id);

alter table public.user_blocks enable row level security;

drop policy if exists "user_blocks_self_rw" on public.user_blocks;
create policy "user_blocks_self_rw" on public.user_blocks
  for all using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- ============================================================
-- G4: DM rate limit — server-side cap to stop spam loops
--   Default: max 30 messages per user per minute, 500 per day
-- ============================================================
create or replace function public.check_dm_rate_limit(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_minute_count int;
  v_day_count int;
begin
  select count(*) into v_minute_count
    from public.dm_messages
    where sender_id = p_user_id
      and created_at > now() - interval '1 minute';
  if v_minute_count >= 30 then return false; end if;

  select count(*) into v_day_count
    from public.dm_messages
    where sender_id = p_user_id
      and created_at > now() - interval '1 day';
  if v_day_count >= 500 then return false; end if;

  return true;
end;
$$;

grant execute on function public.check_dm_rate_limit(uuid) to authenticated;

-- ============================================================
-- G4: Block-aware message insert policy
--   Replaces the existing dm_msg_participant_insert with a stricter version
--   that also rejects messages to a conversation containing someone who blocked you.
-- ============================================================
drop policy if exists "dm_msg_participant_insert" on public.dm_messages;
create policy "dm_msg_participant_insert" on public.dm_messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dm_participants p
      where p.conversation_id = dm_messages.conversation_id and p.user_id = auth.uid()
    )
    -- Reject if any other participant has blocked the sender
    and not exists (
      select 1
      from public.dm_participants p
      join public.user_blocks b on b.blocker_id = p.user_id and b.blocked_id = auth.uid()
      where p.conversation_id = dm_messages.conversation_id
    )
  );

-- ============================================================
-- G4: Admin audit log — sensitive actions
-- ============================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,                                      -- denormalized snapshot
  action text not null,                                  -- 'role_change' | 'campaign_created' | 'user_warned' | etc.
  target_type text,                                      -- 'user' | 'campaign' | 'thread' | 'post'
  target_id uuid,
  details jsonb,                                         -- structured detail
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_actor_idx on public.admin_audit_log(actor_id, created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log(target_type, target_id);

alter table public.admin_audit_log enable row level security;

-- Owners + admins can read
drop policy if exists "audit_log_admin_read" on public.admin_audit_log;
create policy "audit_log_admin_read" on public.admin_audit_log
  for select using (public.is_admin(auth.uid()));

-- Inserts via SECURITY DEFINER function below — no direct insert policy needed
