-- 0323_patch_note_items.sql
--
-- Structured items for a What's New note, so /whats-new/[slug] can show the
-- work as a scoreboard and a searchable ledger instead of one block of prose.
--
-- WHY: the owner felt the patch notes undersold the work (2026-11-17) and
-- picked two layouts from a mockup: a scoreboard of number tiles with a "where
-- the work went" chart (D), above a ledger of every change members can see,
-- searchable and sortable, with a link to each PR (A). Both need the changes
-- as rows, not as markdown bullets.
--
-- Two flat tables, both CSV-exportable:
--   patch_note_items    one row per member-visible change.
--   patch_note_figures  the note's "data kept current" tiles (votes on record,
--                       bill actions, officials added ...), one row per tile.
--                       A small key/value table rather than columns on
--                       patch_notes, because each note carries different
--                       figures (docs/DECISIONS.md, 2026-11-17).
--
-- WHAT'S NEW IS USER-FACING ONLY (owner, 2026-11-06). There is deliberately no
-- area for internal, infrastructure or security work: the area CHECK below has
-- no such value, so a behind-the-scenes row cannot be stored at all. The admin
-- action runs every item through scripts/lib/changelog-safety.mjs as well.
--
-- A note without items keeps rendering its body_md exactly as before. body_md
-- stays required on patch_notes and is the fallback.
--
-- Visibility follows the parent note: anyone may read the items and figures of
-- a PUBLISHED note; drafts stay admin-only, exactly like patch_notes (0250).
--
-- Rollback:
--   DROP VIEW  IF EXISTS public.patch_note_item_counts;
--   DROP TABLE IF EXISTS public.patch_note_figures;
--   DROP TABLE IF EXISTS public.patch_note_items;

CREATE TABLE IF NOT EXISTS public.patch_note_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id       uuid NOT NULL REFERENCES public.patch_notes(id) ON DELETE CASCADE,
  merged_on     date NOT NULL,
  -- The public pull request. NULL for a change with no single PR.
  pr            integer CHECK (pr IS NULL OR pr > 0),
  area          text NOT NULL
                  CHECK (area IN ('bills','letters','community','news','account','speed')),
  type          text NOT NULL CHECK (type IN ('new','fix','faster')),
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  detail        text CHECK (detail IS NULL OR char_length(detail) <= 500),
  -- The change started with something a member told us. Never a name.
  member_report boolean NOT NULL DEFAULT false,
  sort          integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patch_note_items_note_idx
  ON public.patch_note_items (note_id, sort);

COMMENT ON TABLE public.patch_note_items IS
  'Member-visible changes in a What''s New note (/whats-new/[slug] ledger). Public read only when the parent note is published. No internal or security work, ever.';

CREATE TABLE IF NOT EXISTS public.patch_note_figures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id    uuid NOT NULL REFERENCES public.patch_notes(id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key ~ '^[a-z0-9_]{1,40}$'),
  value      numeric NOT NULL,
  label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  detail     text CHECK (detail IS NULL OR char_length(detail) <= 200),
  sort       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, key)
);

COMMENT ON TABLE public.patch_note_figures IS
  'Scoreboard tiles for a What''s New note (value + label + detail). Public read only when the parent note is published.';

ALTER TABLE public.patch_note_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patch_note_figures ENABLE ROW LEVEL SECURITY;

-- Public read of PUBLISHED notes only, matching patch_notes_select_published.
DROP POLICY IF EXISTS patch_note_items_select_published ON public.patch_note_items;
CREATE POLICY patch_note_items_select_published ON public.patch_note_items
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.patch_notes n
    WHERE n.id = patch_note_items.note_id AND n.status = 'published'
  ));

DROP POLICY IF EXISTS patch_note_figures_select_published ON public.patch_note_figures;
CREATE POLICY patch_note_figures_select_published ON public.patch_note_figures
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.patch_notes n
    WHERE n.id = patch_note_figures.note_id AND n.status = 'published'
  ));

-- Admins manage everything, drafts included. Ordinary members write nothing.
DROP POLICY IF EXISTS patch_note_items_admin_all ON public.patch_note_items;
CREATE POLICY patch_note_items_admin_all ON public.patch_note_items
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

DROP POLICY IF EXISTS patch_note_figures_admin_all ON public.patch_note_figures;
CREATE POLICY patch_note_figures_admin_all ON public.patch_note_figures
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- The headline counts on each /whats-new card, one row per note. security_invoker
-- so the items' RLS above decides what an anonymous visitor can count: a draft's
-- items are invisible, so a draft never gets a row.
CREATE OR REPLACE VIEW public.patch_note_item_counts
WITH (security_invoker = true) AS
SELECT
  note_id,
  count(*)::int                                     AS total,
  count(*) FILTER (WHERE type = 'new')::int         AS new_count,
  count(*) FILTER (WHERE type = 'fix')::int         AS fix_count,
  count(*) FILTER (WHERE type = 'faster')::int      AS faster_count,
  count(*) FILTER (WHERE member_report)::int        AS member_reports
FROM public.patch_note_items
GROUP BY note_id;

-- Grants are explicit: new public tables get none by default since 2026-10-30.
GRANT SELECT ON public.patch_note_items TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.patch_note_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patch_note_items TO service_role;

GRANT SELECT ON public.patch_note_figures TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.patch_note_figures TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patch_note_figures TO service_role;

GRANT SELECT ON public.patch_note_item_counts TO anon, authenticated, service_role;
