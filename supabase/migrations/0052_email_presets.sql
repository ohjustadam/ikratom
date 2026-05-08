-- ============================================================
-- 0052_email_presets
--
-- User-defined email tone presets. Each row is one named template the
-- user can pick when sending campaign actions: name + body + signature
-- + tone tag. Caps at 5 per user via a trigger so this stays a
-- "favorites" list, not a CMS.
--
-- Why JSON for body wasn't used: the body is plain text with our
-- {{variable}} placeholders rendered server-side at send time. Text
-- column keeps it simple + searchable + diffable.
-- ============================================================

create table if not exists public.user_email_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  body text not null check (length(body) between 1 and 4000),
  signature text check (signature is null or length(signature) <= 500),
  tone text not null check (tone in ('firm','pleading','business','personal')) default 'firm',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_email_presets_user
  on public.user_email_presets (user_id);

alter table public.user_email_presets enable row level security;

drop policy if exists "email_presets_self" on public.user_email_presets;
create policy "email_presets_self"
  on public.user_email_presets for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 5/user cap
create or replace function public.enforce_email_presets_cap()
returns trigger language plpgsql as $$
declare cnt int;
begin
  select count(*) into cnt from public.user_email_presets where user_id = new.user_id;
  if cnt >= 5 then raise exception 'Email preset limit reached (5 per user)'; end if;
  return new;
end;
$$;

drop trigger if exists trg_email_presets_cap on public.user_email_presets;
create trigger trg_email_presets_cap before insert on public.user_email_presets
  for each row execute function public.enforce_email_presets_cap();

-- Only one default per user — when a row is set is_default=true, clear
-- the flag on every other row for that user. Trigger makes this atomic.
create or replace function public.enforce_single_default_email_preset()
returns trigger language plpgsql as $$
begin
  if new.is_default then
    update public.user_email_presets
       set is_default = false
     where user_id = new.user_id
       and id <> new.id
       and is_default = true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_presets_single_default on public.user_email_presets;
create trigger trg_email_presets_single_default after insert or update of is_default
  on public.user_email_presets
  for each row execute function public.enforce_single_default_email_preset();

-- Auto-bump updated_at
create or replace function public.touch_email_presets_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_email_presets_updated_at on public.user_email_presets;
create trigger trg_email_presets_updated_at before update on public.user_email_presets
  for each row execute function public.touch_email_presets_updated_at();
