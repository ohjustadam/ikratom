-- ============================================================
-- 0037 — Content translation cache
-- ============================================================
-- Pre-translated bill summaries / advocacy callouts / forum thread titles
-- for non-English locales. Populated by `npm run translate:content`
-- (Ollama-driven). Read via getTranslation() at render time.
--
-- Hash on source means we know when source changes and need to retranslate.
-- ============================================================

create table if not exists public.content_translations (
  id uuid primary key default gen_random_uuid(),
  /** What kind of entity is being translated (bills, kratom_stories, forum_threads, etc.) */
  entity_type text not null check (entity_type in ('bill_summary','bill_callout','story_body','thread_title')),
  /** Foreign reference id — not a hard FK so we don't need triggers per type */
  entity_id uuid not null,
  /** Target language ISO 639-1 code */
  target_lang text not null check (target_lang in ('id','th','ms','vi','tl','es')),
  /** Sha-256 of the source text — change detection */
  source_hash text not null,
  translated_text text not null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, target_lang)
);

create index if not exists content_translations_entity_idx
  on public.content_translations (entity_type, entity_id);

alter table public.content_translations enable row level security;

-- Public read: translated text is no more sensitive than the original
drop policy if exists "translations_public_read" on public.content_translations;
create policy "translations_public_read" on public.content_translations
  for select using (true);

-- Service-role only writes (the translation script uses service role)
