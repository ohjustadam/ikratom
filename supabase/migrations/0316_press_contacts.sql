-- 0316_press_contacts.sql
--
-- Media Persuasion (PJ, 2026-11-04): a member can answer a reporter or a
-- researcher the way they answer an official. A row is an address that person
-- printed themselves, on their article or in their paper's PubMed record. We
-- never guess one.
--
-- No member policy on purpose. Addresses reach a signed-in member through
-- getPressContact, which is rate limited, so the list can't be read out in bulk
-- or crawled. Public pages see only the name and outlet, via the service role.
--
-- Rollback:
--   drop table if exists public.press_contacts;
--   alter table public.news_items drop column if exists writer_checked_at;
--   alter table public.research_papers drop column if exists author_checked_at;

create table if not exists public.press_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('reporter', 'researcher')),
  news_item_id uuid references public.news_items(id) on delete cascade,
  paper_id uuid references public.research_papers(id) on delete cascade,
  name text,
  email text not null,
  outlet text,
  found_at timestamptz not null default now(),
  check (num_nonnulls(news_item_id, paper_id) = 1)
);

create unique index if not exists press_contacts_one_per_story
  on public.press_contacts (news_item_id) where news_item_id is not null;
create unique index if not exists press_contacts_one_per_paper
  on public.press_contacts (paper_id) where paper_id is not null;
create index if not exists press_contacts_found_idx
  on public.press_contacts (found_at desc);

alter table public.press_contacts enable row level security;

revoke all on public.press_contacts from anon, authenticated;
grant select, insert, update, delete on public.press_contacts to service_role;

alter table public.news_items
  add column if not exists writer_checked_at timestamptz;
alter table public.research_papers
  add column if not exists author_checked_at timestamptz;
