-- 0267_lock_rate_limit_and_invite_rpcs.sql — two SECURITY DEFINER RPCs that
-- anonymous visitors could call directly over PostgREST.
--
-- Found in the 2026-10-09 security sweep (has_function_privilege on every
-- SECURITY DEFINER function in public: 32 callable by anon):
--   check_rate_limit(p_key, p_max, p_window_seconds) increments ANY key, so a
--     stranger could push another user's bucket to its cap — e.g. their daily
--     campaign-send limit (`campaign:send:user:<uuid>`) or an IP's signup bucket.
--   record_invite_redemption(p_invitee, p_invite_code) records a redemption for
--     ANY invitee, so invite counts/points could be inflated.
-- Both are only meant to be called by the server, which now uses the
-- service-role client for them (src/lib/rate-limit.ts, src/modules/auth/actions.ts).
--
-- ⚠ ORDER: apply this ONLY AFTER the deploy carrying that code is live.
-- checkRateLimit() fails OPEN on an RPC error, so revoking first would silently
-- turn rate limiting off until the deploy lands.
--
-- Rollback:
--   grant execute on function public.check_rate_limit(text, integer, integer) to anon, authenticated;
--   grant execute on function public.record_invite_redemption(uuid, text) to anon, authenticated;

revoke execute on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

revoke execute on function public.record_invite_redemption(uuid, text) from public, anon, authenticated;
grant execute on function public.record_invite_redemption(uuid, text) to service_role;
