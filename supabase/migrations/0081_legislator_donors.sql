-- ============================================================
-- 0081_legislator_donors
--
-- Cache table for OpenFEC campaign-finance data per legislator.
-- Public data; refreshed weekly via cron. Surfaces inline on
-- /legislators/[id] and on campaign send cards so an advocate
-- writing to Senator X sees:
--   "Senator X received $42k from pharmaceutical manufacturing
--    industries in the 2024 cycle (8% of total receipts)."
--
-- Narrative ammo. Public record. Free from data.gov.
-- ============================================================

-- Cache the OpenFEC candidate ID directly on the legislator row so we
-- don't re-search every sync. Federal-only (us_senate, us_house).
alter table public.legislators
  add column if not exists openfec_candidate_id text;

create index if not exists ix_legislators_openfec
  on public.legislators (openfec_candidate_id)
  where openfec_candidate_id is not null;

create table if not exists public.legislator_donors (
  legislator_id uuid primary key references public.legislators(id) on delete cascade,
  openfec_candidate_id text,                -- OpenFEC's identifier; cached after first lookup
  cycle int,                                -- election cycle (e.g. 2024)
  total_receipts numeric,                   -- $ total raised in the cycle
  total_disbursements numeric,
  top_contributors jsonb,                   -- [{name, amount, employer?}]
  top_industries jsonb,                     -- [{industry_code, industry_name, amount, share}]
  top_employers jsonb,                      -- [{employer, amount, share}]
  kratom_relevant jsonb,                    -- {pharma: $X, retail: $Y, tobacco: $Z, alcohol: $W}
  resolved_status text,                     -- 'matched' | 'not_found' | 'ambiguous' | 'no_committee'
  resolve_notes text,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists ix_legislator_donors_cycle
  on public.legislator_donors (cycle, synced_at desc);

-- RLS: public-read (this is public data), admin-write
alter table public.legislator_donors enable row level security;

drop policy if exists legislator_donors_public_read on public.legislator_donors;
create policy legislator_donors_public_read
  on public.legislator_donors
  for select to public using (true);

drop policy if exists legislator_donors_admin_write on public.legislator_donors;
create policy legislator_donors_admin_write
  on public.legislator_donors
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

comment on table public.legislator_donors is
  'Cached campaign-finance summary from OpenFEC. Federal legislators only (us_senate, us_house). Refreshed weekly. See scripts/sync-legislator-donors.mjs and src/lib/openfec.ts.';
