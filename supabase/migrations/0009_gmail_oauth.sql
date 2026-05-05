-- ============================================================
-- 0009 — Gmail OAuth (true one-click batch sending)
-- ============================================================
-- Stores per-user OAuth refresh tokens for Gmail. The token lets us send mail
-- on behalf of the user via the Gmail API, with each message appearing in
-- their own Sent folder.
--
-- SECURITY: tokens are RLS-restricted to the user themselves. Server actions
-- read them via service role + scoped to the authenticated user_id.

create table if not exists public.email_integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null,                          -- 'gmail' | 'outlook' (later)
  account_email text not null,                     -- the connected gmail address
  refresh_token text not null,                     -- long-lived; used to mint access tokens
  scopes text,                                     -- comma-separated scope list
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text                                  -- last refresh/send error if any
);

alter table public.email_integrations enable row level security;

-- Users can read only their own row
drop policy if exists "email_integrations_self_read" on public.email_integrations;
create policy "email_integrations_self_read" on public.email_integrations
  for select using (auth.uid() = user_id);

-- Users can delete their own (disconnect)
drop policy if exists "email_integrations_self_delete" on public.email_integrations;
create policy "email_integrations_self_delete" on public.email_integrations
  for delete using (auth.uid() = user_id);

-- INSERT/UPDATE go through server actions using authenticated session — but we don't
-- expose write policies to client. Server side uses service role for writes via
-- the OAuth callback (which validates state token + user session before writing).
