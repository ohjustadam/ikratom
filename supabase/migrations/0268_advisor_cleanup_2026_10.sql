-- 0268: security-advisor cleanup from the 2026-10-09 sweep. No behaviour change.
--
-- 1. award_points_from_action() and ensure_profile_username() are trigger
--    functions (campaign_actions.trg_award_points, profiles.trg_ensure_profile_username)
--    that anon and authenticated could EXECUTE through the default PUBLIC grant.
--    Calling a trigger function directly only errors, but nothing needs the grant:
--    Postgres does not check EXECUTE when a trigger fires. No policy, default or
--    index references either function (checked via pg_policy/pg_attrdef/pg_index).
-- 2. Pin search_path on the three plain functions the advisor flags as mutable.
--    Their bodies use only NEW.* and literals, so an empty path changes nothing.
--
-- Rollback:
--   grant execute on function public.award_points_from_action() to public;
--   grant execute on function public.ensure_profile_username() to public;
--   alter function public.stamp_campaign_action_sent_at() reset search_path;
--   alter function public.patch_notes_touch_updated_at() reset search_path;
--   alter function public.notification_category(text) reset search_path;

revoke execute on function public.award_points_from_action() from public, anon, authenticated;
revoke execute on function public.ensure_profile_username() from public, anon, authenticated;
grant execute on function public.award_points_from_action() to service_role;
grant execute on function public.ensure_profile_username() to service_role;

alter function public.stamp_campaign_action_sent_at() set search_path = '';
alter function public.patch_notes_touch_updated_at() set search_path = '';
alter function public.notification_category(text) set search_path = '';
