-- 0250_patch_notes.sql
--
-- Serve /whats-new from Postgres instead of from the repo.
--
-- WHY: a patch note lived at src/content/patch-notes/<slug>.md and was read
-- off disk at build time. That path is NOT excluded by the Netlify build
-- `ignore` rule in netlify.toml — the exclude is `:(exclude,glob)*.md`, and
-- git's glob magic stops `*` at a `/`, so only TOP-LEVEL .md files skip a
-- build. Every patch-note merge therefore triggered a production build at 15
-- credits. Telling people what changed cost a deploy, so the cheapest thing
-- to do was say nothing: seven bot drafts sat unmerged between 2026-08-26 and
-- 2026-09-17 and /whats-new went stale.
--
-- With the note in a table, the daily generator writes a row, an admin
-- publishes it with one click, and the page shows it on the next request. No
-- branch, no PR, no build.
--
-- THE CURATION STEP IS DELIBERATE AND IS NOT OPTIONAL. Generator output is a
-- STARTING POINT, never publishable copy — raw commit subjects leaked an
-- editor instruction onto the public page once already (PR #691). That is why
-- rows land as status='draft' and only an admin flips them to 'published'.
-- Nothing in this migration lets a draft reach the public.
--
-- The 40 existing .md files stay exactly where they are and keep rendering.
-- This table is additive; src/lib/patch-notes.ts merges both sources and the
-- database wins on a slug collision.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.patch_notes;

CREATE TABLE IF NOT EXISTS public.patch_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches the .md filename convention (YYYY-MM-DD-update) so the file
  -- back-catalogue and the table share one URL namespace. Immutable once
  -- published — a slug in the wild is a permanent link (AGENTS.md pitfall 8).
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  summary       text,
  -- Markdown. Rendered server-side through the same `marked` call the file
  -- path uses, so a note reads identically whichever source it came from.
  body_md       text NOT NULL,
  -- The date the note is ABOUT (its lookback window), not when it was written.
  published_on  date NOT NULL,
  total_commits integer,
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','archived')),
  -- Who pressed publish. NULL for a row still in draft.
  published_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.patch_notes IS
  'Public changelog entries for /whats-new. Drafts are written by scripts/generate-patch-note.mjs --db; an admin publishes. Never expose status <> published to the public.';

-- The only index that matters: the public list query.
CREATE INDEX IF NOT EXISTS patch_notes_published_idx
  ON public.patch_notes (published_on DESC)
  WHERE status = 'published';

ALTER TABLE public.patch_notes ENABLE ROW LEVEL SECURITY;

-- Public read, PUBLISHED ONLY. `to public` (not `to authenticated`) because
-- /whats-new is a signed-out marketing surface.
DROP POLICY IF EXISTS patch_notes_select_published ON public.patch_notes;
CREATE POLICY patch_notes_select_published ON public.patch_notes
  FOR SELECT TO public
  USING (status = 'published');

-- Admins see and manage everything, drafts included.
DROP POLICY IF EXISTS patch_notes_admin_all ON public.patch_notes;
CREATE POLICY patch_notes_admin_all ON public.patch_notes
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- There is deliberately NO insert/update policy for ordinary users. The
-- generator writes with the service-role key from CI; admins write through
-- server actions that re-check the role. A logged-in user cannot author a
-- changelog entry, which is the whole point.

-- Keep updated_at honest without a trigger-per-column.
CREATE OR REPLACE FUNCTION public.patch_notes_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS patch_notes_touch ON public.patch_notes;
CREATE TRIGGER patch_notes_touch
  BEFORE UPDATE ON public.patch_notes
  FOR EACH ROW EXECUTE FUNCTION public.patch_notes_touch_updated_at();
