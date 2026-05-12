-- 0110: Gate state-briefing generation + welcome notifications.
--
-- Owner directive: NY is the model state — drill it to perfection before
-- enabling generation/notifications for the other 50. Add:
--
--   state_briefings.gen_enabled    boolean → only generate when true
--   site_settings('state_briefing_welcome_enabled') → only notify when true
--
-- Default: gen_enabled = false for all states EXCEPT NY. Owner flips
-- per-state via /admin once each is reviewed.
--
-- Welcome notification flag defaults OFF — even if all 50 states have
-- briefings generated, no user gets pinged about them until the owner
-- explicitly enables the feature globally.
--
-- Rollback:
--   DELETE FROM site_settings WHERE key = 'state_briefing_welcome_enabled';
--   ALTER TABLE state_briefings DROP COLUMN IF EXISTS gen_enabled;
--   ALTER TABLE states DROP COLUMN IF EXISTS briefing_gen_enabled;

-- Per-state gen flag lives on `states` (one row per state always exists)
-- so admin can toggle even before a briefing has been generated.
ALTER TABLE states
  ADD COLUMN IF NOT EXISTS briefing_gen_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN states.briefing_gen_enabled IS
  'When true, scripts/generate-state-briefing.mjs --all-states will regenerate this state. Default false so owner can hand-tune NY first before unlocking the other 50.';

-- Bootstrap: NY is the model. Everyone else stays gated.
UPDATE states SET briefing_gen_enabled = true WHERE abbr = 'NY';

-- Welcome-notification gate. Site-wide singleton flag.
CREATE TABLE IF NOT EXISTS site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text
);

ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read site settings" ON site_settings;
CREATE POLICY "Public read site settings"
  ON site_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admin write site settings" ON site_settings;
CREATE POLICY "Admin write site settings"
  ON site_settings FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Seed: welcome notifications OFF by default.
INSERT INTO site_settings (key, value, note)
VALUES (
  'state_briefing_welcome_enabled',
  'false'::jsonb,
  'When true, signup completion triggers a notification linking the user to their state briefing. Flip via /admin when ready to roll out platform-wide.'
)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE site_settings IS
  'Singleton site-wide feature flags + config. RLS: public read, admin write.';
