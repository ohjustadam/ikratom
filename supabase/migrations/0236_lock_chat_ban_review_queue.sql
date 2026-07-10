-- ============================================================
-- 0236 — Lock chat_ban_review_queue() to service_role (audit pass 2, #5)
-- ============================================================
-- Security audit 2026-07-10 (pass 2, adversarially verified), finding #5 (HIGH).
--
-- chat_ban_review_queue() (0042) is a SECURITY DEFINER function that returns
-- profiles.full_name + mute history for every user whose cumulative mute time is
-- >= the 72h ban-review threshold, with NO internal admin guard. It was granted
-- EXECUTE to `authenticated` (0042:130) and RE-GRANTED to `authenticated` in 0233
-- item 5 — even though 0233 item 2 revoked SELECT on the sibling views it reads
-- (chat_muted_users / chat_mute_totals) from anon+authenticated for exactly this
-- full_name leak. Because it is a DEFINER function it reads those views bypassing
-- RLS, so any authenticated user could call `supabase.rpc('chat_ban_review_queue')`
-- straight from the browser and receive other users' REAL NAMES + moderation
-- history — a cross-user full_name exposure, the paramount public-anonymity rule.
--
-- The only intended caller, listBanReviewQueue (src/modules/admin/lounge-actions.ts),
-- is admin-gated in-app and now runs on the service-role client (like its already-
-- locked-down sibling listMutedChatUsers), so the DB EXECUTE grant is the real
-- boundary. Lock it to service_role, matching the views' 0233 lockdown.
--
-- Rollback: grant execute on function public.chat_ban_review_queue() to authenticated;

revoke execute on function public.chat_ban_review_queue() from public, anon, authenticated;
grant  execute on function public.chat_ban_review_queue() to service_role;
