-- iKratom v1 schema — political action engine
-- Tables: profiles, states, legislators, bills, campaigns, campaign_actions

-- ============================================================
-- profiles: extends auth.users with civic info for autofill
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  street text,
  city text,
  state text,                 -- 2-letter abbr (OK, FL, etc.)
  zip text,
  congressional_district text,
  state_senate_district text,
  state_house_district text,
  is_shop_owner boolean not null default false,
  is_medical_professional boolean not null default false,
  shop_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- states: 50 + DC reference data
-- ============================================================
create table if not exists public.states (
  abbr text primary key,
  name text not null,
  kratom_status text,         -- 'legal' | 'kcpa' | 'banned' | 'restricted'
  notes text
);

-- ============================================================
-- legislators: state + federal officials
-- ============================================================
create table if not exists public.legislators (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.states(abbr),
  role text not null,         -- 'us_senate' | 'us_house' | 'state_senate' | 'state_house'
  district text,              -- nullable for at-large/senate
  full_name text not null,
  party text,
  email text,
  phone text,
  office_address text,
  website text,
  openstates_id text unique,
  legiscan_people_id integer unique,
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists legislators_state_role_idx on public.legislators(state, role);
create index if not exists legislators_active_idx on public.legislators(active);

-- ============================================================
-- bills: kratom/7-OH legislation tracked via LegiScan
-- ============================================================
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  state text not null references public.states(abbr),
  bill_number text not null,  -- 'HB 1234', 'SB 56'
  title text,
  summary text,
  status text,                -- 'introduced' | 'committee' | 'passed_chamber' | 'enacted' | 'dead'
  kratom_relevance text,      -- 'pro' | 'anti' | 'neutral' | 'unknown'
  last_action text,
  last_action_at date,
  legiscan_bill_id integer unique,
  source_url text,
  active boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bills_state_active_idx on public.bills(state, active);

-- ============================================================
-- campaigns: a call-to-action (e.g. "Oppose OK SB 1234")
-- ============================================================
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  blurb text,                          -- 1-2 sentence pitch shown on cards
  body_md text,                        -- full description, why it matters
  state text references public.states(abbr),  -- null = federal/multistate
  bill_id uuid references public.bills(id) on delete set null,
  target_roles text[] not null default '{}',  -- which legislator roles to email
  subject_template text not null,
  body_template text not null,         -- supports {{full_name}}, {{state}}, {{legislator_name}}, etc.
  ai_personalize boolean not null default false,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists campaigns_active_idx on public.campaigns(active);

-- ============================================================
-- campaign_actions: log of one-click sends per user
-- ============================================================
create table if not exists public.campaign_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  legislator_id uuid not null references public.legislators(id) on delete cascade,
  method text not null,                -- 'mailto' | 'platform_email' | 'call'
  subject text,
  body text,
  sent_at timestamptz not null default now()
);

create index if not exists campaign_actions_user_idx on public.campaign_actions(user_id);
create index if not exists campaign_actions_campaign_idx on public.campaign_actions(campaign_id);

-- ============================================================
-- RLS policies
-- ============================================================
alter table public.profiles enable row level security;
alter table public.campaign_actions enable row level security;

-- profiles: user reads/writes own row
create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_write" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_self_insert" on public.profiles
  for insert with check (auth.uid() = id);

-- campaign_actions: user reads/writes own rows
create policy "actions_self_read" on public.campaign_actions
  for select using (auth.uid() = user_id);
create policy "actions_self_insert" on public.campaign_actions
  for insert with check (auth.uid() = user_id);

-- states / legislators / bills / campaigns are public read
alter table public.states enable row level security;
alter table public.legislators enable row level security;
alter table public.bills enable row level security;
alter table public.campaigns enable row level security;

create policy "states_public_read" on public.states for select using (true);
create policy "legislators_public_read" on public.legislators for select using (true);
create policy "bills_public_read" on public.bills for select using (true);
create policy "campaigns_public_read" on public.campaigns for select using (active = true);

-- ============================================================
-- Auto-create profile on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- Seed: 50 states + DC + Oklahoma kratom status
-- ============================================================
insert into public.states (abbr, name, kratom_status) values
  ('AL','Alabama','banned'),
  ('AK','Alaska','legal'),
  ('AZ','Arizona','kcpa'),
  ('AR','Arkansas','banned'),
  ('CA','California','legal'),
  ('CO','Colorado','kcpa'),
  ('CT','Connecticut','legal'),
  ('DE','Delaware','legal'),
  ('FL','Florida','legal'),
  ('GA','Georgia','kcpa'),
  ('HI','Hawaii','legal'),
  ('ID','Idaho','legal'),
  ('IL','Illinois','kcpa'),
  ('IN','Indiana','banned'),
  ('IA','Iowa','legal'),
  ('KS','Kansas','legal'),
  ('KY','Kentucky','legal'),
  ('LA','Louisiana','banned'),
  ('ME','Maine','legal'),
  ('MD','Maryland','legal'),
  ('MA','Massachusetts','legal'),
  ('MI','Michigan','legal'),
  ('MN','Minnesota','legal'),
  ('MS','Mississippi','legal'),
  ('MO','Missouri','legal'),
  ('MT','Montana','legal'),
  ('NE','Nebraska','legal'),
  ('NV','Nevada','kcpa'),
  ('NH','New Hampshire','legal'),
  ('NJ','New Jersey','legal'),
  ('NM','New Mexico','legal'),
  ('NY','New York','legal'),
  ('NC','North Carolina','legal'),
  ('ND','North Dakota','legal'),
  ('OH','Ohio','legal'),
  ('OK','Oklahoma','kcpa'),
  ('OR','Oregon','kcpa'),
  ('PA','Pennsylvania','legal'),
  ('RI','Rhode Island','legal'),
  ('SC','South Carolina','legal'),
  ('SD','South Dakota','legal'),
  ('TN','Tennessee','legal'),
  ('TX','Texas','legal'),
  ('UT','Utah','kcpa'),
  ('VT','Vermont','banned'),
  ('VA','Virginia','legal'),
  ('WA','Washington','legal'),
  ('WV','West Virginia','legal'),
  ('WI','Wisconsin','banned'),
  ('WY','Wyoming','legal'),
  ('DC','District of Columbia','legal')
on conflict (abbr) do update set
  name = excluded.name,
  kratom_status = excluded.kratom_status;
