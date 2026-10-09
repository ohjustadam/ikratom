-- 0270: the places in a state that have local officials on file, with counts.
--
-- 2026-10-09 the county-directory seeder took Tennessee to 1,678 county
-- officials and Kentucky to 682. /legislators loaded EVERY active official of
-- a state in one select: past the PostgREST 1,000-row cap that silently cut
-- off whoever sorted last (state legislators included) and multiplied the
-- payload. The page now loads state + federal officials, and local officials
-- one place at a time; this function gives it the list of places to pick from
-- without downloading the officials themselves.
--
-- SECURITY INVOKER: legislators is public-readable, so anon gets the same
-- rows it could already select. search_path is pinned (advisor lint).
--
-- Rollback: drop function public.local_official_places(text);

create or replace function public.local_official_places(p_state text)
returns table (locality text, level text, n integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.locality, l.level, count(*)::integer as n
  from public.legislators l
  where l.state = upper(p_state)
    and l.active
    and l.level in ('county', 'municipal')
    and l.locality is not null
  group by l.locality, l.level
  order by l.locality;
$$;

grant execute on function public.local_official_places(text) to anon, authenticated, service_role;
