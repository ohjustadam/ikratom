-- 0132 — User-controlled custom reminders.
--
-- Existing system already fires 7d/3d/1d push windows for approved
-- municipal_meetings and bill subscriptions track the active bill set
-- per user. What's missing is the "remind me about THIS specific
-- thing AT THIS specific time" affordance — the user setting their
-- own watch. Owner directive: "this is a weapon that needs to be
-- precise and shield that is unbreakable so their phone becomes
-- their extra hand."
--
-- A reminder targets any one of:
--   - a bill (most common — "remind me 3 days before vote")
--   - a meeting (extra reminder on top of the system 7d/3d/1d)
--   - a campaign (so users don't forget to take action)
--   - a legislator (e.g. "remind me to follow up Sen. X next week")
--   - a news_item (read-later type reminder)
--   - 'custom' — pure text reminder ("call rep about HB 437")
-- target_id is the row id in the corresponding table for non-custom
-- kinds. For 'custom', it stays NULL and title+message carry the
-- whole reminder.
--
-- Firing flow:
--   scripts/fire-custom-reminders.mjs runs hourly. Finds rows where
--   remind_at <= now() AND fired_at IS NULL AND cancelled_at IS NULL.
--   For each, send a push notification via the existing fan-out path
--   (src/lib/push/send.ts). Stamp fired_at. Idempotent on retry.
--
-- Privacy: users see only their own reminders. RLS enforces.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.user_custom_reminders;

CREATE TABLE IF NOT EXISTS public.user_custom_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What to remind about. Polymorphic — target_id resolves to the
  -- row in the corresponding table based on target_kind.
  target_kind text NOT NULL CHECK (target_kind IN (
    'bill', 'meeting', 'campaign', 'legislator', 'news_item', 'custom'
  )),
  target_id uuid,                -- NULL for target_kind='custom'

  -- When to fire (timestamptz so DST + cross-timezone work correctly)
  remind_at timestamptz NOT NULL,

  -- What the user wants the push to say
  title text NOT NULL CHECK (length(title) <= 100),
  message text CHECK (message IS NULL OR length(message) <= 500),

  -- Lifecycle
  fired_at timestamptz,           -- non-NULL after push goes out
  cancelled_at timestamptz,        -- soft-delete; users can cancel before fire

  -- Provenance
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "Find reminders ready to fire" — the hot path for the cron worker.
-- Partial index keeps it tiny: only unfired non-cancelled rows count.
CREATE INDEX IF NOT EXISTS ix_user_custom_reminders_due
  ON public.user_custom_reminders (remind_at)
  WHERE fired_at IS NULL AND cancelled_at IS NULL;

-- "Show me MY reminders, newest first" — the dashboard query.
CREATE INDEX IF NOT EXISTS ix_user_custom_reminders_user
  ON public.user_custom_reminders (user_id, remind_at DESC);

-- Sanity: cancelled_at can't precede creation (caught by app code in
-- practice but DB-level guard is cheap).
ALTER TABLE public.user_custom_reminders
  ADD CONSTRAINT user_custom_reminders_cancelled_after_create
  CHECK (cancelled_at IS NULL OR cancelled_at >= created_at);

-- =============================================================
-- RLS — own user CRUD, admins can read for support
-- =============================================================
ALTER TABLE public.user_custom_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own reminders" ON public.user_custom_reminders;
CREATE POLICY "Users read own reminders"
  ON public.user_custom_reminders FOR SELECT
  USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users create own reminders" ON public.user_custom_reminders;
CREATE POLICY "Users create own reminders"
  ON public.user_custom_reminders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own reminders" ON public.user_custom_reminders;
CREATE POLICY "Users update own reminders"
  ON public.user_custom_reminders FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own reminders" ON public.user_custom_reminders;
CREATE POLICY "Users delete own reminders"
  ON public.user_custom_reminders FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.user_custom_reminders IS
  'User-set custom reminders. Fires via scripts/fire-custom-reminders.mjs hourly using the existing push fan-out. UI: "🔔 Remind me" button on bills/meetings/etc + /reminders dashboard.';
