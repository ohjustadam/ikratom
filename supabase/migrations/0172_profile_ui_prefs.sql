-- 0172_profile_ui_prefs.sql
-- Per-user UI preferences for cross-device theming (theme track PR2).
--   ui_theme  — dark / light
--   ui_accent — brand-color preset
--   ui_mode   — density/framing axis (normal / war-room)
-- All nullable: null means "no saved preference" → the device's localStorage
-- choice (or the app default, dark/emerald/normal) applies. Signed-in users
-- get their saved prefs server-rendered onto <html> (no flash, cross-device).
--
-- Rollback:
--   alter table public.profiles
--     drop column if exists ui_theme,
--     drop column if exists ui_accent,
--     drop column if exists ui_mode;

alter table public.profiles
  add column if not exists ui_theme text,
  add column if not exists ui_accent text,
  add column if not exists ui_mode text;

alter table public.profiles drop constraint if exists profiles_ui_theme_chk;
alter table public.profiles add constraint profiles_ui_theme_chk
  check (ui_theme is null or ui_theme in ('dark', 'light'));

alter table public.profiles drop constraint if exists profiles_ui_accent_chk;
alter table public.profiles add constraint profiles_ui_accent_chk
  check (ui_accent is null or ui_accent in ('emerald', 'blue', 'violet', 'amber', 'rose'));

alter table public.profiles drop constraint if exists profiles_ui_mode_chk;
alter table public.profiles add constraint profiles_ui_mode_chk
  check (ui_mode is null or ui_mode in ('normal', 'war-room'));
