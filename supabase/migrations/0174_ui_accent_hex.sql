-- 0174_ui_accent_hex.sql
-- Theme Studio: per-user CUSTOM brand color (full-spectrum picker).
--
-- Complements ui_accent (the 5 named presets from 0172). When ui_accent_hex
-- is set it WINS over ui_accent: the root layout renders data-accent="custom"
-- + an inline --accent:<hex>, and globals.css derives the full emerald shade
-- ramp from it via color-mix(). Null = fall back to the named preset (or the
-- emerald default). Stored on the profile so the choice follows the user
-- across devices, server-rendered with no flash.
--
-- Rollback:
--   alter table public.profiles drop column if exists ui_accent_hex;

alter table public.profiles
  add column if not exists ui_accent_hex text;

alter table public.profiles drop constraint if exists profiles_ui_accent_hex_chk;
alter table public.profiles add constraint profiles_ui_accent_hex_chk
  check (ui_accent_hex is null or ui_accent_hex ~ '^#[0-9a-fA-F]{6}$');
