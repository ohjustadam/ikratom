-- ============================================================
-- 0043_partners
--
-- Partner shops (kratom retailers, vape shops, herbal stores) that the
-- platform recruits for in-store advocacy. Each partner gets a slug that
-- shows up in QR codes printed on counter posters / window clings; when a
-- customer scans the code, the proxy.ts cookie capture credits any
-- subsequent campaign action back to the partner's slug.
--
-- Why a table at all: the proxy.ts referral capture only needs a string.
-- But for the admin UI to list/edit/print kit assets, we need a source of
-- truth keyed by slug.
--
-- Public read surface: /partners/[host] already exists as a public stats
-- page, so the row's *public* fields (name, city, state, tagline) need to
-- be readable by anyone. Contact info + admin notes do NOT — kept private
-- by exposing only a `partners_public` view.
-- ============================================================

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  -- URL slug used in QR codes: /?ref=embed&host=<slug>
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,80}$'),
  shop_name text not null check (length(shop_name) between 1 and 120),
  city text check (city is null or length(city) <= 80),
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  -- One-line message customizers can set for their poster ("Your local
  -- voice", "Family-owned since 2015", etc.). Falls back to a default if
  -- not set.
  tagline text check (tagline is null or length(tagline) <= 200),
  -- Admin-only contact info; not exposed on the public partner page.
  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists idx_partners_slug on public.partners (slug);

alter table public.partners enable row level security;

-- Admin-only direct table access (read, write, delete).
drop policy if exists "partners_admin_all" on public.partners;
create policy "partners_admin_all"
  on public.partners
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Public view exposes only the columns safe for /partners/[slug] etc.
-- Views are not RLS-checked when owned by a superuser, so readers see
-- exactly the columns we put in the SELECT and nothing else.
create or replace view public.partners_public as
  select id, slug, shop_name, city, state, tagline, created_at
    from public.partners;

grant select on public.partners_public to anon, authenticated;
