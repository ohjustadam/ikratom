-- ============================================================
-- 0238 — policy_alerts column privacy: hide submitter identity (LEAK CLOSURE)
-- ============================================================
-- Security audit 2026-07-10, non-anonymous exposure closure. Companion to 0237
-- (which added public_byline) and the code release that removed every select("*")
-- on policy_alerts and moved the two submitter-column reads to the service-role
-- client. Applied AFTER that code is live (this revoke would break a select("*")).
--
-- policy_alerts_read_approved is `FOR SELECT TO public`, whole-row, so the browser
-- anon key could read submitted_by_user_id + is_anonymous for approved tips and map
-- reporters -> @username — for NON-anonymous tips too (pass-1/mig 0235 only nulled
-- the id for anonymous ones). Postgres can't subtract a column from a table SELECT
-- grant, so REVOKE the table grant and re-GRANT only the public-safe columns
-- (proven pattern from 0227). submitted_by_user_id + is_anonymous become readable
-- ONLY via the service-role client (admin moderation + the author's own "my tips").
-- RLS (moderation_status='approved') still applies on top.
--
-- FAIL-SAFE: any NEW column added later is NOT anon-readable until added to the
-- GRANT below — a future submitter/PII field can't silently leak.
--
-- Rollback: GRANT SELECT ON public.policy_alerts TO anon, authenticated;

revoke select on public.policy_alerts from anon, authenticated;

grant select (
  id, kind, severity, title, body, locality, source_url, bill_id, briefing_slug,
  bop_board_id, action_required, campaign_id, moderation_status, moderation_note,
  moderated_by, moderated_at, occurs_at, expires_at, created_at, updated_at,
  discord_posted_at, dedupe_key, auto_pushed_at, auto_pushed_count, specific_locality,
  officials_extracted_at, public_byline
) on public.policy_alerts to anon, authenticated;
