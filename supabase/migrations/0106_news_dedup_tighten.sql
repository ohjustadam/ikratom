-- 0106: Tighten news_items dedup — cross-state syndication + scraped_at ties.
--
-- The existing trigger (migration 0080) dedups on (normalize_title, state)
-- within 14 days. Two problems:
--
--   1. Cross-state syndication leaks. Google News returns the same
--      Tennessee bill article when we query "kratom Florida" because
--      Google does fuzzy state matching. So the same article ends up
--      stored with state=TN, FL, GA, AL, etc. — same title, different
--      state, so dedup doesn't fire.
--
--   2. Race condition on identical scraped_at. The trigger looks for an
--      "earlier" canonical (scraped_at <= new.scraped_at), but two rows
--      inserted at the same millisecond both see "no earlier" and
--      neither links. Result: identical-title duplicates in same state.
--
-- This migration:
--   - Updates the trigger to dedup on resolved_url FIRST (added in 0104),
--     falling back to (normalize_title, state) when resolved_url is null
--   - Handles scraped_at ties by tie-breaking on id < new.id
--   - Back-fills: link existing same-resolved_url and same-(norm_title,state)
--     duplicates whose canonical link is missing
--
-- Rollback: replace this trigger with the 0080 version.

-- ----------------------------------------
-- 1. Improved trigger function
-- ----------------------------------------
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

  -- Layer 1: resolved_url match (exact publisher URL = same article,
  -- regardless of state scope we filed it under). This catches the
  -- cross-state syndication leak that the title-based check misses.
  if new.resolved_url is not null then
    select id into v_canonical_id
      from public.news_items
     where id <> new.id
       and duplicate_of is null
       and resolved_url = new.resolved_url
       and scraped_at > (now() - interval '30 days')
       and (
         scraped_at < new.scraped_at
         or (scraped_at = new.scraped_at and id < new.id)
       )
     order by scraped_at asc, id asc
     limit 1;
    if v_canonical_id is not null then
      new.duplicate_of := v_canonical_id;
      return new;
    end if;
  end if;

  -- Layer 2: normalized title + state match within 14 days (original
  -- 0080 logic, with scraped_at-tie tie-break added).
  v_norm := public.normalize_news_title(new.title);
  if v_norm is null or length(v_norm) < 12 then
    return new;
  end if;

  select id into v_canonical_id
    from public.news_items
   where id <> new.id
     and duplicate_of is null
     and public.normalize_news_title(title) = v_norm
     and coalesce(state, '') = coalesce(new.state, '')
     and scraped_at > (now() - interval '14 days')
     and (
       scraped_at < new.scraped_at
       or (scraped_at = new.scraped_at and id < new.id)
     )
   order by scraped_at asc, id asc
   limit 1;

  if v_canonical_id is not null then
    new.duplicate_of := v_canonical_id;
  end if;

  return new;
end;
$$;

-- Trigger itself is unchanged from 0080 — same name, same firing rules.
-- (We're just swapping out the function.)

-- ----------------------------------------
-- 2. Back-fill: link existing cross-state syndication duplicates by
--    resolved_url. Earliest in each cluster stays canonical.
-- ----------------------------------------
with ranked as (
  select id, scraped_at, resolved_url,
         row_number() over (
           partition by resolved_url
           order by scraped_at asc, id asc
         ) as rn,
         first_value(id) over (
           partition by resolved_url
           order by scraped_at asc, id asc
         ) as canonical_id
    from public.news_items
   where resolved_url is not null
     and duplicate_of is null
     and scraped_at > (now() - interval '60 days')
)
update public.news_items n
   set duplicate_of = r.canonical_id
  from ranked r
 where n.id = r.id
   and r.rn > 1;

-- ----------------------------------------
-- 3. Back-fill: scraped_at-tie duplicates the 0080 backfill missed
--    (same (norm_title, state) within 14 days where canonical's
--    scraped_at exactly equals duplicate's scraped_at).
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
     and scraped_at > (now() - interval '60 days')
     and public.normalize_news_title(title) is not null
     and length(public.normalize_news_title(title)) >= 12
)
update public.news_items n
   set duplicate_of = r.canonical_id
  from ranked r
 where n.id = r.id
   and r.rn > 1;

comment on function public.news_items_set_duplicate_of is
  'Dedup news on resolved_url first (cross-state syndication), then (norm_title, state) within 14 days. Handles scraped_at ties via id tie-break. See migrations 0080 + 0106.';
