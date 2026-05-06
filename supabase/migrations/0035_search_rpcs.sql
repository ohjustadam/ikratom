-- ============================================================
-- 0035 — Search RPC functions
-- ============================================================

-- search_bills(q): full-text search across bills with active=true
-- Ranked by ts_rank, returns top 30
create or replace function public.search_bills(p_q text)
returns table (
  id uuid,
  state text,
  bill_number text,
  title text,
  summary_ai text,
  kratom_relevance text,
  scope text,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id, state, bill_number, title, summary_ai, kratom_relevance, scope,
    ts_rank(search_vector, websearch_to_tsquery('english', p_q)) as rank
  from public.bills
  where active = true
    and search_vector @@ websearch_to_tsquery('english', p_q)
  order by rank desc, last_action_at desc nulls last
  limit 30;
$$;

grant execute on function public.search_bills(text) to anon, authenticated;

-- search_threads(q): forum threads where moderation_status='approved'
create or replace function public.search_threads(p_q text)
returns table (
  id uuid,
  state text,
  title text,
  body text,
  created_at timestamptz,
  rank real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    id, state, title, body, created_at,
    ts_rank(search_vector, websearch_to_tsquery('english', p_q)) as rank
  from public.forum_threads
  where moderation_status = 'approved'
    and search_vector @@ websearch_to_tsquery('english', p_q)
  order by rank desc, created_at desc
  limit 30;
$$;

grant execute on function public.search_threads(text) to anon, authenticated;
