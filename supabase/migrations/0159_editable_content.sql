-- ============================================================
-- 0159_editable_content
--
-- Mini-CMS for admin-editable page copy. The key problem this
-- solves: the platform owner needs to update text-on-pages
-- (support tier amounts, ethics intro paragraph, how-it-works
-- steps, etc.) from any device — phone, borrowed laptop, anywhere
-- with a browser — WITHOUT git, IDE, or a deploy cycle.
--
-- Pattern: each editable chunk has a stable string key like
-- 'support.intro' or 'ethics.body'. Pages call
-- `getContent('support.intro', defaultFallback)`. If the DB has
-- a row, that wins; otherwise the code-defined fallback wins.
--
-- This keeps the code as the source of truth for STRUCTURE
-- (which pages exist, what props they accept) while letting
-- admins override the COPY at runtime.
--
-- What this is NOT:
--   - Not a full CMS — no page builder, no rich media, no slots
--   - Not a translation system — that's a separate i18n table
--   - Not user-generated content — admin-write only
--
-- RLS:
--   - Public SELECT (every visitor reads to render the page)
--   - Admin INSERT/UPDATE/DELETE — gated via is_admin(uid)
--
-- Rollback:
--   DROP TABLE IF EXISTS editable_content;

create table if not exists public.editable_content (
  -- Stable key. Format: '<page>.<section>' or '<page>.<section>.<idx>'.
  -- Lowercase, dots + hyphens + underscores allowed.
  -- e.g. 'support.intro', 'support.tier.0.label', 'ethics.body'.
  key text primary key
    check (key ~ '^[a-z][a-z0-9._-]{2,99}$'),

  -- The content body. Markdown by default; pages render via the
  -- existing sanitized markdown renderer.
  content_md text not null
    check (char_length(content_md) <= 50000),

  -- Format hint. 'markdown' renders through the sanitizer; 'plain'
  -- treats as literal text (escaped). 'html' is intentionally NOT
  -- offered — raw HTML is a footgun for an in-site editor.
  format text not null default 'markdown'
    check (format in ('markdown', 'plain')),

  -- Optional short label shown in the admin list view so the owner
  -- can find what they're looking for without reading the key.
  label text check (label is null or char_length(label) <= 200),

  -- Audit fields — who and when.
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,

  -- Optional: published_at lets you stage a draft before it goes live.
  -- When null → live immediately. When set in the future → not yet
  -- visible. v1 doesn't use this; reserved for v2.
  published_at timestamptz
);

-- Touch trigger so updated_at always reflects the last write.
create or replace function public.editable_content_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists editable_content_touch_trigger on public.editable_content;
create trigger editable_content_touch_trigger
  before update on public.editable_content
  for each row execute function public.editable_content_touch();

-- Audit log of every change (kept indefinitely; lets the owner see
-- "what did I edit last week?" + roll back manually if a change
-- breaks something).
create table if not exists public.editable_content_history (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  content_md text not null,
  format text not null,
  label text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists editable_content_history_key_idx
  on public.editable_content_history (key, changed_at desc);

-- History trigger — capture previous state before each update.
create or replace function public.editable_content_audit()
returns trigger language plpgsql as $$
begin
  insert into public.editable_content_history (key, content_md, format, label, changed_by)
    values (old.key, old.content_md, old.format, old.label, old.updated_by);
  return new;
end;
$$;
drop trigger if exists editable_content_audit_trigger on public.editable_content;
create trigger editable_content_audit_trigger
  before update on public.editable_content
  for each row execute function public.editable_content_audit();

-- ── RLS
alter table public.editable_content enable row level security;
alter table public.editable_content_history enable row level security;

-- Public read: every visitor needs to read to render pages.
drop policy if exists "editable_content: public read" on public.editable_content;
create policy "editable_content: public read"
  on public.editable_content for select
  using (true);

-- Admin write: gated to admins (or owner — is_admin() returns true
-- for owners by convention in this codebase).
drop policy if exists "editable_content: admin write insert" on public.editable_content;
create policy "editable_content: admin write insert"
  on public.editable_content for insert
  with check (public.is_admin(auth.uid()));

drop policy if exists "editable_content: admin write update" on public.editable_content;
create policy "editable_content: admin write update"
  on public.editable_content for update
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

drop policy if exists "editable_content: admin write delete" on public.editable_content;
create policy "editable_content: admin write delete"
  on public.editable_content for delete
  using (public.is_admin(auth.uid()));

-- History is admin-read-only — nobody writes to it directly; the
-- trigger handles that with elevated implicit privilege.
drop policy if exists "editable_content_history: admin read" on public.editable_content_history;
create policy "editable_content_history: admin read"
  on public.editable_content_history for select
  using (public.is_admin(auth.uid()));
