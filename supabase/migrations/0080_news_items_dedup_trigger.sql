-- ============================================================
-- 0080_news_items_dedup_trigger
--
-- Deterministic news dedup on insert. /news already filters
-- `duplicate_of IS NULL` (canonical-only view), but the only thing
-- populating that pointer was scripts/dedupe-news.mjs (Ollama
-- embeddings, manual run only). Now every sync-news-rss insert
-- gets fingerprinted against existing canonicals — same normalized
-- title + state + last 7 days → link as duplicate of the earliest.
--
-- Same normalize_news_title() helper as policy_alerts (0079) so the
-- fingerprint matches across both surfaces. No AI needed; runs at
-- DB-level instantly.
--
-- This handles the common cases:
--   "Iowa House passes bill banning kratom - Quad-City Times"
--   "Iowa House passes bill banning kratom - The Gazette"
--   "Iowa House passes bill banning kratom - WHO13"
--   → first one inserted as canonical; later 2 get duplicate_of set.
--
-- Cross-state syndications ("Morning Briefing in the Bluegrass" 17x)
-- still cluster correctly because state is included in the key —
-- same state's repeat publications collapse, different states stay
-- separate (which is what we want for state-feed accuracy).
-- ============================================================

create or replace function public.news_items_set_duplicate_of()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_canonical_id uuid;
begin
  -- Skip if already explicitly linked (manual or prior pass)
  if new.duplicate_of is not null then return new; end if;

  v_norm := public.normalize_news_title(new.title);
  if v_norm is null or length(v_norm) < 12 then
    return new; -- title too short to dedup safely
  end if;

  -- Find an earlier canonical with the same normalized title + state
  -- within the last 14 days. Earliest wins; we link to it.
  select id into v_canonical_id
    from public.news_items
   where id <> new.id
     and duplicate_of is null
     and public.normalize_news_title(title) = v_norm
     and coalesce(state, '') = coalesce(new.state, '')
     and scraped_at > (now() - interval '14 days')
     and scraped_at <= new.scraped_at
   order by scraped_at asc
   limit 1;

  if v_canonical_id is not null then
    new.duplicate_of := v_canonical_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_news_items_dedup on public.news_items;
create trigger trg_news_items_dedup
  before insert
  on public.news_items
  for each row
  execute function public.news_items_set_duplicate_of();

-- ----------------------------------------
-- Backfill: scan recent news_items, link duplicates to canonicals.
-- Earliest in each (norm_title, state) cluster stays canonical;
-- the rest get duplicate_of set.
-- ----------------------------------------
with ranked as (
  select id, scraped_at,
         public.normalize_news_title(title) as norm_title,
         state,
         row_number() over (
           partition by public.normalize_news_title(title), coalesce(state, '')
           order by scraped_at asc, id asc
         ) as rn,
         first_value(id) over (
           partition by public.normalize_news_title(title), coalesce(state, '')
           order by scraped_at asc, id asc
         ) as canonical_id
    from public.news_items
   where duplicate_of is null
     and scraped_at > (now() - interval '30 days')
     and public.normalize_news_title(title) is not null
     and length(public.normalize_news_title(title)) >= 12
)
update public.news_items n
   set duplicate_of = r.canonical_id
  from ranked r
 where n.id = r.id
   and r.rn > 1;

comment on trigger trg_news_items_dedup on public.news_items is
  'Auto-link duplicates of same normalized title + state within 14 days. Earliest stays canonical. /news already filters duplicate_of IS NULL so canonical surfaces cleanly. See migration 0080.';
