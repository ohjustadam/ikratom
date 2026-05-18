-- ============================================================
-- 0157_read_only_mode
--
-- Adds `read_only_mode` to the site_config singleton. When flipped
-- ON, the platform refuses to accept mutations from non-admin users
-- (campaigns, stories, signups, coalition creates, comments).
-- Admins can still operate so they can clean up whatever triggered
-- the lockdown.
--
-- This is the "emergency brake." Use cases:
--   - Suspected compromise (e.g. RLS bypass discovered live)
--   - Spam wave that you need a few hours to triage
--   - Database quota approaching cap; stop accepting writes
--
-- Pairs with the existing `emergency_mode` flag (red banner) but is
-- functionally distinct: emergency_mode is a USER-facing alert;
-- read_only_mode is an APPLICATION-level mutation gate.
--
-- Rollback:
--   ALTER TABLE site_config DROP COLUMN read_only_mode;
--   ALTER TABLE site_config DROP COLUMN read_only_reason;

alter table public.site_config
  add column if not exists read_only_mode  boolean not null default false,
  add column if not exists read_only_reason text;

comment on column public.site_config.read_only_mode is
  'When true, the application layer refuses non-admin mutations. Triggered manually by admins from /admin/emergency. Pairs with emergency_mode (user-facing banner). Admin can still operate. Independent of RLS — this is an app-level check.';

comment on column public.site_config.read_only_reason is
  'Optional human-readable explanation surfaced to users when they hit a refused mutation. e.g. "Spam wave triage — back in 1 hour".';
