-- Live proof for migration 0330 (news twins). Runs against prod with zero
-- side effects: every check runs inside one DO block that ends by raising, so
-- the whole thing rolls back. Success is the error text "ROLLBACK-OK …".
-- Run with the Supabase MCP execute_sql, or psql.
do $$
declare
  tag text := 'twin-proof-' || md5(random()::text);
  a uuid; b uuid; c uuid; d uuid;
  b_dup uuid; c_dup uuid; a_count int; d_url text;
begin
  insert into public.news_items (title, url, active, scraped_at)
  values (tag || ' alpha story', 'https://news.google.com/rss/articles/' || tag || '-a', true, now() - interval '2 hours')
  returning id into a;
  insert into public.news_items (title, url, active, scraped_at)
  values (tag || ' bravo story', 'https://news.google.com/rss/articles/' || tag || '-b', true, now() - interval '1 hour')
  returning id into b;
  -- c is already a duplicate of b (as the title layer would make it).
  insert into public.news_items (title, url, active, scraped_at, duplicate_of)
  values (tag || ' charlie story', 'https://news.google.com/rss/articles/' || tag || '-c', true, now(), b)
  returning id into c;
  insert into public.news_items (title, url, active, scraped_at)
  values (tag || ' delta story', 'https://news.google.com/rss/articles/' || tag || '-d', true, now())
  returning id into d;

  -- a resolves first and stays canonical; b resolves to the same URL.
  update public.news_items set resolved_url = 'https://example.org/' || tag where id = a;
  update public.news_items set resolved_url = 'https://example.org/' || tag where id = b;
  -- d resolves to an error page.
  update public.news_items set resolved_url = 'chrome-error://chromewebdata/' where id = d;

  select duplicate_of into b_dup from public.news_items where id = b;
  select duplicate_of into c_dup from public.news_items where id = c;
  select duplicate_count into a_count from public.news_items where id = a;
  select resolved_url into d_url from public.news_items where id = d;

  if b_dup is distinct from a then raise exception 'FAIL: twin b not linked to a (got %)', b_dup; end if;
  if c_dup is distinct from a then raise exception 'FAIL: b''s duplicate c not folded onto a (got %)', c_dup; end if;
  if a_count <> 2 then raise exception 'FAIL: a.duplicate_count = %, expected 2', a_count; end if;
  if d_url is not null then raise exception 'FAIL: error page stored as resolved_url (%)', d_url; end if;
  if (select duplicate_of from public.news_items where id = a) is not null then raise exception 'FAIL: a lost its canonical status'; end if;

  raise exception 'ROLLBACK-OK: twin linked, child folded, count 2, error page refused';
end $$;
