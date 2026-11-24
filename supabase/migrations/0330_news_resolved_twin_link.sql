-- 0330_news_resolved_twin_link.sql
--
-- WHY (audit 2026-11-24): 7,511 news_items rows share a resolved_url with
-- another row. 2,332 of those twins were still active and not marked as
-- duplicates, so feeds could list the same story twice. Another 44 rows held
-- `chrome-error://chromewebdata/` as their resolved_url, an error page saved
-- as the answer by the old headless resolver.
--
-- ROOT CAUSE: one story reaches us under several Google News URLs. Ingest
-- dedupes on that Google `url`, and resolved_url is still NULL at insert, so
-- the insert trigger's resolved_url check (news_items_set_duplicate_of,
-- Layer 1, migration 0106) never had anything to compare. resolve-news-urls
-- fills resolved_url later with an UPDATE, and nothing looked at it then.
--
-- FIX:
--   1. public.is_usable_news_url(text): an http(s) URL on a dotted host that is
--      not a Google redirect, Google's consent or "sorry" page, or Akamai's
--      block page. Same rule as isUsableResolvedUrl() in
--      scripts/lib/news-resolved-url.mjs (a test keeps the two in step).
--   2. BEFORE INSERT OR UPDATE OF resolved_url: an unusable URL is stored as
--      NULL, so it reads as "not resolved yet" and the resolver retries it.
--      Named so it sorts before trg_news_items_dedup and runs first on insert.
--   3. AFTER UPDATE OF resolved_url: when a row resolves to a URL another
--      canonical row already has, the newcomer becomes its duplicate. An
--      active canonical is preferred, then the oldest. This is a separate
--      UPDATE of duplicate_of rather than a change to NEW, because the
--      duplicate_count trigger fires only on UPDATE OF duplicate_of and would
--      miss a BEFORE-trigger change.
--   4. AFTER UPDATE OF duplicate_of: when a canonical becomes a duplicate,
--      its own duplicates move to the new canonical, so no chain forms.
--   5. Repair: the 44 error-page values go back to NULL.
--
-- Reversible. Nothing is deleted; the cleanup of existing twins is
-- scripts/dedupe-news-resolved.mjs, which waits for the owner's yes.
--
-- ROLLBACK:
--   drop trigger if exists trg_news_items_clean_resolved_url on public.news_items;
--   drop trigger if exists trg_news_items_link_resolved_twin on public.news_items;
--   drop trigger if exists trg_news_items_fold_duplicate_children on public.news_items;
--   drop function if exists public.news_items_clean_resolved_url();
--   drop function if exists public.news_items_link_resolved_twin();
--   drop function if exists public.news_items_fold_duplicate_children();
--   drop function if exists public.is_usable_news_url(text);
--   Step 5 cleared the same value on every row it touched. The ids are in
--   private/backups/news-chrome-error-ids-2026-11-24.json on the owner's PC:
--   update public.news_items set resolved_url = 'chrome-error://chromewebdata/'
--    where id in (<those ids>);
--   (Not needed in practice: those rows simply re-resolve.)

-- ── 1. the rule ─────────────────────────────────────────────────────────
create or replace function public.is_usable_news_url(u text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select h.host is not null
       and position('.' in h.host) > 0
       and h.host not in ('news.google.com', 'consent.google.com', 'errors.edgesuite.net')
       and not (h.host = 'google.com' and lower(u) ~ '^https?://(www\.)?google\.com/sorry')
      from (
        select regexp_replace(
                 substring(lower(btrim(u)) from '^https?://([^/?#:@]+)'),
                 '^www\.', '') as host
      ) h
  ), false);
$$;

comment on function public.is_usable_news_url(text) is
  'True for an http(s) publisher URL; false for error pages, Google redirect/consent/sorry pages and Akamai blocks. Mirrors isUsableResolvedUrl() in scripts/lib/news-resolved-url.mjs. Migration 0330.';

-- ── 2. an error page is not an answer ──────────────────────────────────
create or replace function public.news_items_clean_resolved_url()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resolved_url is not null and not public.is_usable_news_url(new.resolved_url) then
    new.resolved_url := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_news_items_clean_resolved_url on public.news_items;
create trigger trg_news_items_clean_resolved_url
  before insert or update of resolved_url
  on public.news_items
  for each row
  execute function public.news_items_clean_resolved_url();

-- ── 3. a newly resolved twin hides behind the story we already have ────
create or replace function public.news_items_link_resolved_twin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canonical uuid;
begin
  if new.resolved_url is null
     or new.resolved_url is not distinct from old.resolved_url
     or new.duplicate_of is not null then
    return null;
  end if;

  -- Served by ix_news_items_dedup_resolved_url (0252): partial on
  -- duplicate_of IS NULL AND resolved_url IS NOT NULL.
  select id into v_canonical
    from public.news_items
   where resolved_url = new.resolved_url
     and duplicate_of is null
     and id <> new.id
   order by active desc, scraped_at asc, id asc
   limit 1;

  if v_canonical is not null then
    update public.news_items
       set duplicate_of = v_canonical
     where id = new.id
       and duplicate_of is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_news_items_link_resolved_twin on public.news_items;
create trigger trg_news_items_link_resolved_twin
  after update of resolved_url
  on public.news_items
  for each row
  execute function public.news_items_link_resolved_twin();

-- ── 4. no duplicate chains ──────────────────────────────────────────────
create or replace function public.news_items_fold_duplicate_children()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.duplicate_of is null and new.duplicate_of is not null then
    update public.news_items
       set duplicate_of = new.duplicate_of
     where duplicate_of = new.id
       and id <> new.duplicate_of;
    -- The new canonical was itself one of this row's duplicates: free it,
    -- or the two would point at each other.
    update public.news_items
       set duplicate_of = null
     where id = new.duplicate_of
       and duplicate_of = new.id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_news_items_fold_duplicate_children on public.news_items;
create trigger trg_news_items_fold_duplicate_children
  after update of duplicate_of
  on public.news_items
  for each row
  execute function public.news_items_fold_duplicate_children();

-- ── 5. repair the error-page resolutions (44 rows on 2026-11-24) ───────
update public.news_items
   set resolved_url = null
 where resolved_url is not null
   and not public.is_usable_news_url(resolved_url);

-- ── grants: trigger functions are never called by clients ──────────────
-- (EXECUTE is not checked when a trigger fires.)
revoke execute on function public.news_items_clean_resolved_url() from public, anon, authenticated;
revoke execute on function public.news_items_link_resolved_twin() from public, anon, authenticated;
revoke execute on function public.news_items_fold_duplicate_children() from public, anon, authenticated;
grant execute on function public.news_items_clean_resolved_url() to service_role;
grant execute on function public.news_items_link_resolved_twin() to service_role;
grant execute on function public.news_items_fold_duplicate_children() to service_role;
revoke execute on function public.is_usable_news_url(text) from public, anon, authenticated;
grant execute on function public.is_usable_news_url(text) to service_role;
