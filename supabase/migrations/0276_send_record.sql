-- 0276_send_record.sql
--
-- B9 (owner-approved 2026-10-21, Cloudflare token 2026-10-23): keep a copy of
-- letters members send from their OWN mail program ("Open in Gmail", Outlook
-- web, the default email app, copy-paste). Until now those paths only told us
-- the member CLICKED; the letter itself and whether it went out were unknown.
--
-- How it works:
--   1. The compose buttons add a hidden copy (BCC) to r-<nonce>@ikratom.org,
--      with a visible notice and an opt-out. The nonce (16 chars, base32) is
--      stored on the campaign_actions rows the click logs.
--   2. A Cloudflare Email Worker (scripts/cloudflare/send-record-worker.js,
--      deployed by scripts/deploy-send-record-worker.mjs) receives the copy
--      and calls public.ingest_send_record() with a shared key.
--   3. The RPC stores the letter as sent and marks the matching
--      campaign_actions rows verified. A nonce that matches no click is
--      dropped, never stored.
--
-- Rollback:
--   drop function if exists public.ingest_send_record(text, text, text, text, text, text, text);
--   drop table if exists public.personal_send_records;
--   drop table if exists internal.ingest_keys;
--   drop trigger if exists trg_guard_action_verified on public.campaign_actions;
--   drop function if exists public.guard_action_verified();
--   alter table public.campaign_actions drop constraint if exists campaign_actions_record_nonce_fmt,
--     drop column if exists record_nonce, drop column if exists verified_at;
--   and point the Cloudflare catch-all back at "drop"
--   (node scripts/deploy-send-record-worker.mjs --rollback).

-- 1. The click log carries the nonce; verification is stamped by the RPC only.
alter table public.campaign_actions
  add column if not exists record_nonce text,
  add column if not exists verified_at timestamptz;

alter table public.campaign_actions drop constraint if exists campaign_actions_record_nonce_fmt;
alter table public.campaign_actions
  add constraint campaign_actions_record_nonce_fmt
  check (record_nonce is null or record_nonce ~ '^[a-z2-7]{16}$');

create index if not exists campaign_actions_record_nonce_idx
  on public.campaign_actions (record_nonce) where record_nonce is not null;

-- A member writes campaign_actions through their own session (RLS self-insert),
-- so without this they could insert verified_at = now() and fake a confirmed
-- send. Only the SECURITY DEFINER ingest (current_user = owner) may set it.
create or replace function public.guard_action_verified()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
    else
      new.verified_at := old.verified_at;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_action_verified on public.campaign_actions;
create trigger trg_guard_action_verified
  before insert or update on public.campaign_actions
  for each row execute function public.guard_action_verified();

-- 2. The letters themselves. Flat, CSV-exportable.
create table if not exists public.personal_send_records (
  id uuid primary key default gen_random_uuid(),
  record_nonce text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  from_address text,
  to_header text,
  subject text,
  body_text text,
  message_id text,
  matched_actions int not null default 0,
  received_at timestamptz not null default now()
);

create unique index if not exists personal_send_records_message_id_uq
  on public.personal_send_records (message_id) where message_id is not null;
create index if not exists personal_send_records_user_idx
  on public.personal_send_records (user_id, received_at desc);
create index if not exists personal_send_records_campaign_idx
  on public.personal_send_records (campaign_id);

alter table public.personal_send_records enable row level security;

drop policy if exists personal_send_records_read on public.personal_send_records;
create policy personal_send_records_read on public.personal_send_records
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

-- Explicit grants (Supabase stops default-granting new public tables
-- 2026-10-30). Members read their own; nobody writes except the ingest RPC.
revoke all on table public.personal_send_records from public, anon, authenticated;
grant select on table public.personal_send_records to authenticated;
grant all on table public.personal_send_records to service_role;

-- 3. The shared key the Worker presents. Not in an exposed schema, so no API
-- role can read it; only its SHA-256 is stored.
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

create table if not exists internal.ingest_keys (
  name text primary key,
  key_sha256 text not null check (key_sha256 ~ '^[0-9a-f]{64}$'),
  rotated_at timestamptz not null default now()
);
revoke all on table internal.ingest_keys from public, anon, authenticated;

-- 4. The ingest. Called by the Worker with the anon key + the shared key.
create or replace function public.ingest_send_record(
  p_key text,
  p_nonce text,
  p_from text,
  p_to text,
  p_subject text,
  p_body text,
  p_message_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_hash text;
  v_user uuid;
  v_campaign uuid;
  v_matched int := 0;
  v_msgid text := nullif(left(btrim(coalesce(p_message_id, '')), 300), '');
begin
  select key_sha256 into v_hash from internal.ingest_keys where name = 'send_record';
  if v_hash is null
     or v_hash <> encode(extensions.digest(convert_to(coalesce(p_key, ''), 'UTF8'), 'sha256'), 'hex') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_nonce is null or p_nonce !~ '^[a-z2-7]{16}$' then
    return jsonb_build_object('ok', false, 'reason', 'bad-nonce');
  end if;

  if v_msgid is not null and exists (
    select 1 from public.personal_send_records where message_id = v_msgid
  ) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  select ca.user_id, ca.campaign_id into v_user, v_campaign
  from public.campaign_actions ca
  where ca.record_nonce = p_nonce
  order by ca.sent_at desc
  limit 1;

  -- No click carries this nonce: a guessed address or stray mail. Keep nothing.
  if v_user is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown-nonce');
  end if;

  update public.campaign_actions
  set verified_at = now()
  where record_nonce = p_nonce
    and verified_at is null
    and sent_at > now() - interval '14 days';
  get diagnostics v_matched = row_count;

  insert into public.personal_send_records
    (record_nonce, user_id, campaign_id, from_address, to_header, subject, body_text, message_id, matched_actions)
  values
    (p_nonce, v_user, v_campaign, left(p_from, 320), left(p_to, 2000), left(p_subject, 300),
     left(p_body, 20000), v_msgid, v_matched);

  return jsonb_build_object('ok', true, 'matched', v_matched);
end $$;

revoke all on function public.ingest_send_record(text, text, text, text, text, text, text) from public, authenticated;
grant execute on function public.ingest_send_record(text, text, text, text, text, text, text) to anon, service_role;
