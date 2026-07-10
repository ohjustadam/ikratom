-- ============================================================
-- 0233_security_advisor_hardening
--
-- Fixes the confirmed-real findings from the Supabase security advisors
-- (2026-07-09 pre-launch sweep; every item verified against actual grants,
-- consumers, and catalog references before inclusion):
--
-- 1. scraper_runs_latest view was SECURITY DEFINER + anon-SELECTable →
--    any visitor could read internal ops telemetry incl. raw error_message.
--    → security_invoker: the scraper_runs RLS (admin-only) now governs.
--    Admin pages (user-scoped admin sessions) keep working unchanged;
--    service-role consumers (/status, cockpit, checklist, AI editor)
--    bypass RLS as before. /pitch/efficiency switches to service-role
--    in the same PR (it shows a curated public subset by design).
--
-- 2. chat_muted_users view exposed profiles.full_name to ANON — a DB-layer
--    violation of the public-anonymity standing rule (real names must never
--    be visible cross-user). chat_mute_totals exposed moderation history.
--    → revoke anon+authenticated; the only consumer (admin lounge actions)
--    switches to the service-role client in the same PR. The
--    chat_ban_review_queue RPC reads these as their owner (definer) and
--    is unaffected.
--
-- 3. storage: `attach_public_read` gave EVERYONE SELECT on the
--    campaign-attachments bucket = the ability to LIST every object path
--    (paths embed user ids). The app's model is "public bucket,
--    unguessable path" (actions-attachments.ts) — listing defeats it.
--    → drop the policy. getPublicUrl downloads are unaffected (public
--    buckets serve by URL without RLS); owner insert/select/delete
--    policies remain.
--
-- 4. 25 internal SECURITY DEFINER functions (23 trigger-bound + 2 helpers
--    called only inside the auto-campaign trigger) were executable by
--    anon+authenticated → any visitor could invoke RLS-bypassing mutators
--    directly (e.g. bump_action_streak, award_call_achievements).
--    Postgres does NOT check EXECUTE for the DML role when a trigger
--    fires, and nested calls inside a DEFINER function check the definer
--    — verified via pg_trigger/pg_policy/pg_attrdef/pg_constraint scan
--    that nothing else references them. → revoke from PUBLIC/anon/
--    authenticated, keep service_role.
--
-- 5. 8 member/admin-scoped RPCs revoked from ANON only (they are called
--    client-side by signed-in flows — verified via codebase .rpc() grep):
--    DM helpers, coalition join, invite summary, admin queues.
--    Public RPCs (get_public_profile(s), homepage_stats, ai_jobs_stats,
--    call_leaderboard, search_*, check_rate_limit, record_invite_redemption,
--    visible_announcements, coalition_*, forum_stats, bop_*, wave counts)
--    stay callable — each is either deliberately public or used in
--    anon-context flows (signup rate-limit / invite redemption).
--    RLS-policy helpers (is_admin, is_verified, is_campaign_creator,
--    is_coalition_admin/member) MUST stay granted — policies evaluate
--    them as the querying role.
--
-- 6. Pin search_path=public on the 30 functions flagged mutable
--    (search-path hijack hardening; zero behavior change — they resolve
--    unqualified public objects exactly as before).
--
-- Deliberately NOT changed (verified intentional):
--    - bill_actions_latest / campaign_wave_counts / public_call_intel /
--      partners_public / discord_integrations_public: public-safe
--      projections by design (that's their whole job).
--    - campaign_shares anonymous INSERT: deliberate share-tracking.
--    - _ikratom_migrations / rate_limits RLS-no-policy: default-deny,
--      service-role-only bookkeeping — correct as-is.
--    - auth leaked-password protection: requires Supabase Pro (owner call).
--
-- Rollback: re-grant the revoked EXECUTEs / SELECTs, re-create
-- attach_public_read (SELECT USING bucket_id='campaign-attachments'),
-- and `alter view public.scraper_runs_latest reset (security_invoker)`.
-- ============================================================

-- ── 1. scraper_runs_latest respects scraper_runs RLS ─────────────────
alter view public.scraper_runs_latest set (security_invoker = true);

-- ── 2. chat moderation views: admin/service-role only ────────────────
revoke select on public.chat_muted_users from anon, authenticated;
revoke select on public.chat_mute_totals from anon, authenticated;

-- ── 3. storage: stop public LISTING of campaign-attachments ──────────
drop policy if exists attach_public_read on storage.objects;

-- ── 4. internal SECURITY DEFINER functions: no client execution ──────
do $$
declare
  fn text;
  sig text;
begin
  foreach fn in array array[
    -- trigger-bound (pg_trigger-verified; EXECUTE is not checked on firing)
    'auto_campaign_on_alert','auto_first_call_goal','award_call_achievements',
    'bop_auto_emit_policy_alert','bump_action_streak','bump_forum_post_count',
    'bump_inviter_first_action','critical_action_alert',
    'guard_call_session_moderation','guard_call_session_rate',
    'guard_campaign_action_rate','guard_dm_conversation_keys',
    'guard_dm_participant_update','guard_forum_post_update',
    'guard_forum_thread_update','guard_profiles_self_privilege',
    'handle_new_user','news_items_set_duplicate_of',
    'notifications_category_gate','notify_admins_on_bop_finding',
    'notify_state_briefing_on_state_set','set_profile_invite_code',
    'update_intel_tier_on_moderation',
    -- called only inside auto_campaign_on_alert (definer context)
    'pick_targets_for_alert','pick_template_for_alert'
  ]
  loop
    for sig in
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
    end loop;
  end loop;
end $$;

-- ── 5. member/admin RPCs: authenticated-only (verified callers) ──────
do $$
declare
  fn text;
  sig text;
begin
  foreach fn in array array[
    'get_dm_member_public_keys','get_my_blocked_profiles',
    'search_users_by_username','check_dm_rate_limit',
    'join_coalition_via_code','get_my_invite_summary',
    'chat_ban_review_queue','get_stale_bop_sources'
  ]
  loop
    for sig in
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke execute on function %s from public, anon', sig);
      execute format('grant execute on function %s to authenticated, service_role', sig);
    end loop;
  end loop;
end $$;

-- ── 6. pin search_path (hijack hardening, zero behavior change) ──────
do $$
declare
  fn text;
  sig text;
begin
  foreach fn in array array[
    'bill_addresses_substance','build_alert_campaign_slug',
    'bump_news_duplicate_count','calc_intel_tier','campaign_topic_key',
    'campaigns_set_topic_key','coalitions_touch_updated_at',
    'compute_policy_alert_dedupe_key','deny_audit_log_tamper',
    'editable_content_audit','editable_content_touch',
    'enforce_email_presets_cap','enforce_saved_searches_cap',
    'enforce_single_default_email_preset','forum_communities_touch_updated_at',
    'normalize_news_title','notification_category','render_template_for_alert',
    'set_policy_alert_dedupe_key','touch_bop_sources',
    'touch_dashboard_layouts_updated_at','touch_email_presets_updated_at',
    'touch_external_communities_updated_at','touch_updated_at',
    'touch_user_permissions','trg_campaign_notify','trg_dm_message_inserted',
    'trg_forum_post_inserted','trg_forum_post_softdeleted',
    'trg_forum_reaction_changed'
  ]
  loop
    for sig in
      select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('alter function %s set search_path = public', sig);
    end loop;
  end loop;
end $$;
