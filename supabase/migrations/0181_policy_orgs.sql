-- 0181_policy_orgs.sql
-- Canonical registry of kratom / 7-OH POLICY organizations — pro, anti, and
-- regulators — seeded from the org-census research and surfaced at
-- /intel/opposition. This is the maintainable, scrape-able successor to the
-- hardcoded src/lib/kratom-industry-actors.ts registry, and the foundation for
-- the counter-intel monitoring to come (daily scrapers will set monitor_url +
-- last_seen_at + activity). Posture matches /intel/actors: public-read, noindex,
-- factual public-record data only.
--
-- Rollback: drop table if exists public.policy_orgs;

create table if not exists public.policy_orgs (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  stance text not null
    check (stance in ('anti_kratom', 'anti_7oh', 'pro_kratom', 'pro_7oh', 'mixed', 'regulator', 'unclear')),
  org_type text
    check (org_type is null or org_type in
      ('advocacy', 'trade_industry', 'medical_publichealth', 'government', 'grassroots', 'funder_lobbying', 'academic', 'other')),
  website text,
  summary text,                                   -- one-line: what they do / why this stance
  evidence jsonb not null default '[]'::jsonb,     -- public-record citation URLs / notes
  confidence text check (confidence is null or confidence in ('high', 'medium', 'low')),
  confirmed boolean not null default false,
  active boolean not null default true,
  -- dossier fields (populated later — the "founders / funding / motives" vision)
  leadership text,
  funding_note text,
  -- monitoring hooks (the daily org scraper uses these later)
  monitor_url text,
  last_seen_at timestamptz,
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_policy_orgs_stance on public.policy_orgs (stance);

alter table public.policy_orgs enable row level security;

-- Public read (noindex page, factual public-record data — same posture as
-- /intel/actors). Writes are service-role (seed + scrapers) and admin.
drop policy if exists "policy_orgs: public read" on public.policy_orgs;
create policy "policy_orgs: public read" on public.policy_orgs for select using (true);

drop policy if exists "policy_orgs: admin write" on public.policy_orgs;
create policy "policy_orgs: admin write" on public.policy_orgs for update
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
