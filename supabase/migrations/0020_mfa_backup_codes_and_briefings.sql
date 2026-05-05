-- ============================================================
-- 0020 — MFA backup codes + Campaign research briefings
-- ============================================================
-- Two unrelated additions, bundled because they're both small.
-- ============================================================

-- ── MFA backup codes ────────────────────────────────────────
-- Stored as SHA-256 of the plaintext code. Plaintext is shown to the user
-- exactly once at generation; the server keeps only the hash for verify.
-- Each code is single-use: consuming sets `used_at` and the row is no
-- longer eligible. User can regenerate at any time, which deletes all
-- prior codes for that user.
create table if not exists public.mfa_backup_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_backup_codes_user_id_idx
  on public.mfa_backup_codes (user_id, used_at);

-- Users may *read* their own codes (just the metadata: created/used) so the
-- UI can show "8 codes generated, 2 used". Plaintext is never readable.
-- All writes go through the service-role client in actions-backup-codes.ts.
alter table public.mfa_backup_codes enable row level security;

drop policy if exists "backup_codes_self_read" on public.mfa_backup_codes;
create policy "backup_codes_self_read" on public.mfa_backup_codes
  for select using (auth.uid() = user_id);

-- ── Campaigns: research briefing column ─────────────────────
-- Free-text briefing generated locally by `npm run research:campaign`.
-- Keeps it append-only-feel: regenerating overwrites; we don't archive
-- past briefings.
alter table public.campaigns
  add column if not exists briefing text,
  add column if not exists briefing_generated_at timestamptz;
