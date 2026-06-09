-- 0191_legistar_tenants.sql
--
-- Intent: expand the FREE, keyless Legistar webapi officials source beyond the
-- ~22 hand-curated tenants. `discover-legistar-tenants.mjs` probes candidate
-- {client}.legistar.com slugs derived from the Census gazetteer for each
-- locality we serve/are-asked-about and caches the result here. Both the batch
-- sync (sync-legistar-officials.mjs) and the live path (src/lib/legistar-roster.ts)
-- read this table so neither needs Gemini-grounded search to find a roster.
--
-- This is the Tier-1 half of de-Gemini-ing local-officials lookup (see
-- private/LOCAL_REPS_DEGEMINI_PLAN.md): deterministic clerk data first; the
-- SearXNG+Ollama long-tail path covers what isn't on Legistar.
--
-- Rollback: drop table public.legistar_tenants cascade;

create table if not exists public.legistar_tenants (
  id            uuid primary key default gen_random_uuid(),
  state         text not null,                 -- 2-letter, uppercase
  locality      text not null,                 -- canonical "City, ST" / "County, ST"
  subdomain     text,                          -- host for People.aspx links (may differ from client)
  webapi_client text,                          -- the {client} code in webapi.legistar.com/v1/{client}; null when probe_status != 'live'
  body          text,                          -- council/board body-name hint (optional)
  probe_status  text not null default 'live',  -- 'live' | 'none' (not on Legistar) | 'error'
  officials_count integer,                     -- last roster size seen (telemetry only)
  probed_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (state, locality)
);

create index if not exists legistar_tenants_state_status_idx
  on public.legistar_tenants (state, probe_status);

comment on table public.legistar_tenants is
  'Cache of (locality -> Legistar webapi {client}) discovered by probing. Source of truth for keyless deterministic local-officials lookup; replaces Gemini-grounded search for covered localities.';

alter table public.legistar_tenants enable row level security;

-- Service-role (cron + server actions) bypasses RLS. Admins can read/write
-- from the dashboard. No anon/public access needed — this is internal infra.
create policy "legistar_tenants admin read" on public.legistar_tenants
  for select using (public.is_admin(auth.uid()));
create policy "legistar_tenants admin write" on public.legistar_tenants
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Seed the 22 hand-curated tenants (mirror of scripts/lib/legistar-tenants.mjs
-- with CLIENT_OVERRIDES applied) so the LIVE path has them immediately without
-- importing a script module. Discovery upserts more over time. ON CONFLICT
-- DO NOTHING keeps this idempotent and lets discovery refresh rows later.
insert into public.legistar_tenants (state, locality, subdomain, webapi_client, body, probe_status) values
  ('NY','New York, NY','council.nyc.gov','nyc','City Council','live'),
  ('CA','San Francisco, CA','sfgov','sfgov','Board of Supervisors','live'),
  ('CA','Los Angeles County, CA','lacountybos','lacountybos','Board of Supervisors','live'),
  ('CA','Alameda County, CA','alameda','alameda','Board of Supervisors','live'),
  ('CA','Santa Clara County, CA','sccgov-bos','sccgov-bos','Board of Supervisors','live'),
  ('CA','Long Beach, CA','longbeach','longbeach','City Council','live'),
  ('CA','Berkeley, CA','berkeley','berkeley','City Council','live'),
  ('CA','Richmond, CA','richmondca','richmondca','City Council','live'),
  ('PA','Philadelphia, PA','phila','phila','City Council','live'),
  ('NJ','Newark, NJ','newark','newark','Municipal Council','live'),
  ('VA','Alexandria, VA','alexandria','alexandria','City Council','live'),
  ('IL','Chicago, IL','chicago','chicago','City Council','live'),
  ('IL','Cook County, IL','cookcountyil','cookcounty','Board of Commissioners','live'),
  ('MO','St. Louis, MO','stlouis-mo','stlouis-mo','Board of Aldermen','live'),
  ('MO','Kansas City, MO','kansascity','kansascity','City Council','live'),
  ('TX','San Antonio, TX','sanantonio','sanantonio','City Council','live'),
  ('GA','Atlanta, GA','atlantacityga','atlantacityga','City Council','live'),
  ('FL','Miami, FL','miamigov','miamigov','City Commission','live'),
  ('FL','Broward County, FL','broward','broward','Board of County Commissioners','live'),
  ('WA','Seattle, WA','seattle','seattle','City Council','live'),
  ('WA','King County, WA','kingcounty','kingcounty','County Council','live'),
  ('OR','Portland Metro, OR','metro','oregonmetro','Metro Council','live')
on conflict (state, locality) do nothing;
