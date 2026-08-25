-- 0248_campaign_send_batches.sql
--
-- Durable, resumable outbound send queue.
--
-- WHY: sending was synchronous inside a server action. Closing the tab killed
-- the run, a 198-recipient selection stopped dead at the flat 100/day cap, and
-- there was no record of who had already been written to — so "resume" meant
-- "start over and hope the dedupe held". Owner directive 2026-08-22: once a
-- send starts it must finish, even if the user closes the window.
--
-- SHAPE: a batch is the user's intent; items are the individual, personalised
-- messages. One row per recipient because we never BCC — every legislator gets
-- their own message, which is both better deliverability and the only form
-- that survives a partial failure cleanly (retry recipient 47, not all 198).
--
-- ── SECURITY MODEL (the part that matters) ────────────────────────────────
-- This table drives REAL EMAIL from a user's OWN mailbox. If a user could
-- insert arbitrary rows here, iKratom would be a free spam relay wearing that
-- user's From: address. So clients get SELECT ONLY on both tables. Every write
-- goes through a server action that re-derives recipients from the campaign's
-- own scope and never trusts an address supplied by the browser.
--
-- The UNIQUE (batch_id, legislator_id) constraint is the no-double-send
-- guarantee: a retry, a double-click, or a worker that runs twice cannot
-- produce two emails to the same office.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.campaign_send_batch_items;
--   DROP TABLE IF EXISTS public.campaign_send_batches;
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS email_provider_tier;

-- ── user's declared provider tier (overrides detection) ────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_provider_tier text;

COMMENT ON COLUMN public.profiles.email_provider_tier IS
  'Optional user override for their mail provider tier (gmail_free | gmail_workspace | outlook_consumer | outlook_business). NULL = detect from the connected address. Ignored if it does not match the connected provider.';

-- ── the batch ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_send_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  campaign_id    uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  provider       text NOT NULL,
  provider_tier  text NOT NULL,
  -- Snapshot of the rendered templates AT ENQUEUE TIME. If an admin edits the
  -- campaign mid-batch, recipients 1-40 and 41-198 must not receive materially
  -- different letters over the user's name.
  subject_template text NOT NULL,
  body_template    text NOT NULL,
  status         text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sending','paused','complete','cancelled','failed')),
  total_count    integer NOT NULL DEFAULT 0,
  sent_count     integer NOT NULL DEFAULT 0,
  failed_count   integer NOT NULL DEFAULT 0,
  -- Set when the batch stops for a reason the USER must act on (revoked token,
  -- provider cap). Surfaced verbatim in the UI — a stalled batch with no
  -- explanation is how the fire-waves outage stayed invisible for 24 days.
  pause_reason   text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  last_progress_at timestamptz
);

COMMENT ON TABLE public.campaign_send_batches IS
  'Durable outbound send queue. A batch survives the browser tab that created it. Clients may SELECT only; all writes go through validated server actions.';

CREATE INDEX IF NOT EXISTS ix_send_batches_user ON public.campaign_send_batches (user_id, created_at DESC);
-- The worker''s pickup query.
CREATE INDEX IF NOT EXISTS ix_send_batches_drainable ON public.campaign_send_batches (status, created_at)
  WHERE status IN ('queued','sending');

-- ── one row per recipient ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.campaign_send_batch_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid NOT NULL REFERENCES public.campaign_send_batches(id) ON DELETE CASCADE,
  legislator_id uuid NOT NULL REFERENCES public.legislators(id) ON DELETE CASCADE,
  -- Snapshotted so a legislator record edited mid-batch cannot redirect mail
  -- that the user already authorised to a different address.
  email         text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','skipped')),
  attempts      integer NOT NULL DEFAULT 0,
  error         text,
  sent_at       timestamptz,
  CONSTRAINT uq_batch_item UNIQUE (batch_id, legislator_id)
);

COMMENT ON CONSTRAINT uq_batch_item ON public.campaign_send_batch_items IS
  'No-double-send guarantee: a retry, a double-click, or two overlapping worker runs cannot produce two emails to the same office.';

CREATE INDEX IF NOT EXISTS ix_batch_items_drain ON public.campaign_send_batch_items (batch_id, status)
  WHERE status = 'pending';

-- ── RLS: read your own, write nothing ──────────────────────────────────────
ALTER TABLE public.campaign_send_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_send_batch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS send_batches_self_read ON public.campaign_send_batches;
CREATE POLICY send_batches_self_read ON public.campaign_send_batches
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS send_batch_items_self_read ON public.campaign_send_batch_items;
CREATE POLICY send_batch_items_self_read ON public.campaign_send_batch_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.campaign_send_batches b
      WHERE b.id = campaign_send_batch_items.batch_id
        AND b.user_id = auth.uid()
    )
  );

-- NOTE: deliberately NO insert/update/delete policy for either table. An RLS
-- table with no policy for an operation makes that operation a silent no-op
-- returning success (this bit us before — kicked DM members kept access because
-- dm_participants had no DELETE policy). Here that default is exactly what we
-- want and it is intentional, not an oversight: the service role bypasses RLS,
-- so the worker and the validated server actions still write normally.
