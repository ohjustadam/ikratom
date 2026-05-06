-- ============================================================
-- 0032 — Bill sponsors
-- ============================================================
-- OpenStates returns a sponsorships[] array on every bill: who introduced
-- it, who co-sponsored, primary vs co-author. We store this so:
--   1. /bills/[id] can show "Sponsored by Sen. Smith (R-12)"
--   2. /legislators/[id] can show "Sponsored 4 anti-kratom bills"
--   3. Future: cross-reference voting record + persuadability scoring
-- ============================================================

create table if not exists public.bill_sponsors (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  /** Match against legislators.id when we can — many sponsors will have
      one (since we sync the same state's legislators), but some won't
      (deceased, term-limited, recently elected and not synced yet). */
  legislator_id uuid references public.legislators(id) on delete set null,
  /** Display name as OpenStates returned it — survives even if we never
      match a legislator row. */
  name text not null,
  /** 'primary' (introducer) | 'cosponsor' | 'other' */
  classification text not null default 'cosponsor',
  /** Free-form party/role/district hints from OpenStates if we have them */
  party text,
  district text,
  created_at timestamptz not null default now(),
  unique (bill_id, name, classification)
);

create index if not exists bill_sponsors_bill_idx on public.bill_sponsors (bill_id);
create index if not exists bill_sponsors_legislator_idx
  on public.bill_sponsors (legislator_id) where legislator_id is not null;

alter table public.bill_sponsors enable row level security;

-- Public read; writes via service-role from sync only
drop policy if exists "bill_sponsors_public_read" on public.bill_sponsors;
create policy "bill_sponsors_public_read" on public.bill_sponsors
  for select using (true);
