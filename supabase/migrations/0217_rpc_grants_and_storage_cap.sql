-- ============================================================
-- 0217 — Revoke default PUBLIC execute on internal RPCs + cap the
--        campaign-attachments storage bucket
-- ============================================================
-- (A) RPC grants (live-posture finding): Postgres grants EXECUTE on a function
--     to PUBLIC by default. Several SECURITY DEFINER RPCs were `grant ... to
--     service_role`'d but never had the default PUBLIC grant REVOKED, so they're
--     live-callable by any authenticated user (rpc/<name>). The ones below are
--     ONLY invoked by cron scripts (service-role) or internally by triggers
--     (which run as the definer regardless of grants) — never by a user session
--     (verified: grep of src/ + scripts/ .rpc callers). Revoking PUBLIC closes:
--       • claim_local_job            — drain/DoS the box job queue
--       • notify_users_for_campaign  — mass notification spam
--       • retarget_auto_campaign(s)  — tamper with campaign targets
--       • prune_ai_jobs / prune_email_quota_log — nuisance cleanup calls
--     NOT touched (verified user-session callers — revoking would break the app):
--       check_rate_limit (lib/rate-limit.ts), record_invite_redemption (signup),
--       search_*/get_public_*/is_* (RLS predicates + read RPCs).
-- (B) STORAGE-01: campaign-attachments is a PUBLIC bucket with no MIME allowlist
--     or size cap, so a user could upload arbitrary HTML/SVG/JS (served from our
--     storage origin) or exhaust free-tier storage. The recorder
--     (AttachmentRecorder.tsx) only ever uploads audio/video webm, so restrict to
--     audio/* + video/* (blocks text/html + image/svg+xml) and a 25 MB cap.
--
-- Rollback: re-grant execute to public on the funcs; null the bucket limits.

-- ── (A) RPC grant lockdown ──────────────────────────────────
revoke execute on function public.claim_local_job(text[]) from public, anon, authenticated;
grant  execute on function public.claim_local_job(text[]) to service_role;

revoke execute on function public.notify_users_for_campaign(uuid) from public, anon, authenticated;
grant  execute on function public.notify_users_for_campaign(uuid) to service_role;

revoke execute on function public.retarget_auto_campaign(uuid) from public, anon, authenticated;
grant  execute on function public.retarget_auto_campaign(uuid) to service_role;

revoke execute on function public.retarget_auto_campaigns_for_locality(text, text) from public, anon, authenticated;
grant  execute on function public.retarget_auto_campaigns_for_locality(text, text) to service_role;

revoke execute on function public.prune_ai_jobs() from public, anon, authenticated;
grant  execute on function public.prune_ai_jobs() to service_role;

revoke execute on function public.prune_email_quota_log() from public, anon, authenticated;
grant  execute on function public.prune_email_quota_log() to service_role;

-- ── (B) campaign-attachments bucket cap ─────────────────────
update storage.buckets
   set allowed_mime_types = array['audio/*', 'video/*'],
       file_size_limit    = 26214400  -- 25 MB
 where id = 'campaign-attachments';
