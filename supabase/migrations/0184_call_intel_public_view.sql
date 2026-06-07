-- 0184_call_intel_public_view.sql
-- Build #4 (calls→intel): make the public intel board functional AND safe.
--
--  1. QUERYABLE POSITION + QUOTE-FREE PUBLIC SUMMARY. The AI summary already
--     extracts the legislator's stated position + key quotes, but bakes them
--     into ai_summary_md as free text (the board had to regex the position back
--     out, and the quotes — a named official's verbatim words — would show
--     publicly). Add legislator_position (queryable, for "what is government
--     saying" rollups) + public_summary_md (a QUOTE-FREE, PII-light summary for
--     the public board). The quote-bearing ai_summary_md stays PRIVATE to the
--     caller + the admin moderation view.
--
--  2. CLOSE A LATENT LEAK. The old call_sessions_approved_public_read policy
--     returned the FULL row — including user_id and the raw transcript_md — to
--     anon for any approved call. Replace it with a column-scoped public VIEW so
--     the only world-readable data is the safe, anonymized columns.
--
-- Rollback: drop the view + columns/constraint; re-create the old broad policy.

alter table public.call_sessions
  add column if not exists legislator_position text,
  add column if not exists public_summary_md text;

do $$ begin
  alter table public.call_sessions
    add constraint call_sessions_legislator_position_chk
      check (legislator_position is null or legislator_position in
        ('supportive', 'opposed', 'undecided', 'unclear', 'not_discussed'));
exception when duplicate_object then null; end $$;

comment on column public.call_sessions.legislator_position is
  'Queryable stated position from the AI summary (set at finalize/approve) — powers per-state/per-official rollups on /calls/board.';
comment on column public.call_sessions.public_summary_md is
  'QUOTE-FREE, PII-light summary safe for the public intel board. The full ai_summary_md (may quote the official verbatim) stays private to caller + admin moderation.';

-- Drop the over-broad public-read policy (exposed user_id + transcript_md).
drop policy if exists "call_sessions_approved_public_read" on public.call_sessions;

-- Column-scoped public window onto APPROVED calls only. Definer-rights view
-- (security_invoker off, the default) so it can expose these safe columns
-- without a table-level anon policy — NO user_id, NO transcript_md, NO
-- quote-bearing ai_summary_md ever leaves via this surface.
drop view if exists public.public_call_intel;
create view public.public_call_intel as
  select
    id, recipient_name, recipient_role, recipient_office, state,
    legislator_position, public_summary_md, outcome, duration_seconds, started_at
  from public.call_sessions
  where moderation_status = 'approved';

comment on view public.public_call_intel is
  'Public, anonymized, column-scoped window onto approved call intel for /calls/board. Excludes user_id, transcript_md, and the verbatim-quote ai_summary_md by construction.';

grant select on public.public_call_intel to anon, authenticated;
