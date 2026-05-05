-- ============================================================
-- 0019 — Bills LLM enrichment + News deduplication via embeddings
-- ============================================================
-- Both features run via local Ollama (free) on the maintainer's desktop:
--   npm run enrich:bills    — adds AI summary + advocacy callout per bill
--   npm run dedupe:news     — embeds news titles, links syndicated dupes
-- ============================================================

-- ── Bills enrichment columns ────────────────────────────────
alter table public.bills
  add column if not exists summary_ai text,
  add column if not exists advocacy_callout text,
  add column if not exists relevance_confidence numeric(3,2),
  add column if not exists enriched_at timestamptz;

-- Index so the enricher can quickly find unenriched / stale-enriched bills.
-- "Stale" = bill was re-synced after enrichment, summary_ai may be outdated.
create index if not exists bills_enriched_at_idx
  on public.bills (enriched_at);

-- ── News deduplication columns ──────────────────────────────
-- embedding: 768-dim float array from Ollama's nomic-embed-text, stored as
--   jsonb for portability (no pgvector dependency). For ~10k items this is
--   ~100MB which is fine on Supabase free tier; switch to pgvector later if
--   we ever need ANN search at scale.
-- duplicate_of: when set, this row is a syndicated copy of a canonical row.
--   The news page filters to duplicate_of IS NULL so each story shows once.
-- duplicate_count: denormalized count of children for fast "also in X states"
--   badge on the canonical row.
alter table public.news_items
  add column if not exists embedding jsonb,
  add column if not exists embedded_at timestamptz,
  add column if not exists duplicate_of uuid
    references public.news_items(id) on delete set null,
  add column if not exists duplicate_count integer not null default 0;

create index if not exists news_items_embedded_at_idx
  on public.news_items (embedded_at);

create index if not exists news_items_duplicate_of_idx
  on public.news_items (duplicate_of);

-- ── Trigger: keep duplicate_count in sync ───────────────────
-- When a child row's duplicate_of changes, bump/decrement the canonical.
create or replace function public.bump_news_duplicate_count()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    if new.duplicate_of is not null then
      update public.news_items
        set duplicate_count = duplicate_count + 1
        where id = new.duplicate_of;
    end if;
  elsif (tg_op = 'UPDATE') then
    if old.duplicate_of is distinct from new.duplicate_of then
      if old.duplicate_of is not null then
        update public.news_items
          set duplicate_count = greatest(0, duplicate_count - 1)
          where id = old.duplicate_of;
      end if;
      if new.duplicate_of is not null then
        update public.news_items
          set duplicate_count = duplicate_count + 1
          where id = new.duplicate_of;
      end if;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.duplicate_of is not null then
      update public.news_items
        set duplicate_count = greatest(0, duplicate_count - 1)
        where id = old.duplicate_of;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists news_items_duplicate_count_trigger on public.news_items;
create trigger news_items_duplicate_count_trigger
  after insert or update of duplicate_of or delete on public.news_items
  for each row execute function public.bump_news_duplicate_count();
