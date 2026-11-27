-- 0338: an index for every link to a user, so deleting an account finishes.
--
-- Intent. Deleting a user makes Postgres find that user's rows in every table
-- with a foreign key to auth.users or public.profiles. 66 of those columns had
-- no index, so each one was a full table scan. The delete took 4.5 s on an idle
-- database and passed Supabase Auth's 10 s limit on 2026-11-26, which means the
-- one-click deletion /privacy promises could fail.
--
-- Nullable columns get a partial index (`where col is not null`): most rows hold
-- null there, so the index stays tiny, and the lookup (`col = $1`) still uses it.
--
-- Changes no data. Rollback: drop the indexes ending _user_ref_idx.
-- A new foreign key to a user needs its own index; the weekly security check
-- (scripts/check-security-advisors.mjs) fails when one is missing.

create index if not exists ai_jobs_user_id_user_ref_idx
  on public.ai_jobs (user_id) where user_id is not null;

create index if not exists announcements_created_by_user_ref_idx
  on public.announcements (created_by) where created_by is not null;

create index if not exists bill_stakeholders_added_by_user_id_user_ref_idx
  on public.bill_stakeholders (added_by_user_id) where added_by_user_id is not null;

create index if not exists bop_findings_reviewed_by_user_ref_idx
  on public.bop_findings (reviewed_by) where reviewed_by is not null;

create index if not exists call_goals_user_id_user_ref_idx
  on public.call_goals (user_id);

create index if not exists call_sessions_moderation_reviewed_by_user_ref_idx
  on public.call_sessions (moderation_reviewed_by) where moderation_reviewed_by is not null;

create index if not exists campaign_shares_user_id_user_ref_idx
  on public.campaign_shares (user_id) where user_id is not null;

create index if not exists campaign_template_versions_edited_by_user_ref_idx
  on public.campaign_template_versions (edited_by) where edited_by is not null;

create index if not exists campaign_waves_created_by_user_ref_idx
  on public.campaign_waves (created_by) where created_by is not null;

create index if not exists campaigns_reviewed_by_user_ref_idx
  on public.campaigns (reviewed_by) where reviewed_by is not null;

create index if not exists chat_moderation_queue_reviewed_by_user_ref_idx
  on public.chat_moderation_queue (reviewed_by) where reviewed_by is not null;

create index if not exists chat_moderation_queue_user_id_user_ref_idx
  on public.chat_moderation_queue (user_id);

create index if not exists chat_mute_history_muted_by_user_ref_idx
  on public.chat_mute_history (muted_by) where muted_by is not null;

create index if not exists coalition_district_captains_assigned_by_user_ref_idx
  on public.coalition_district_captains (assigned_by) where assigned_by is not null;

create index if not exists coalition_events_created_by_user_ref_idx
  on public.coalition_events (created_by) where created_by is not null;

create index if not exists coalition_invites_created_by_user_ref_idx
  on public.coalition_invites (created_by) where created_by is not null;

create index if not exists coalition_join_requests_decided_by_user_ref_idx
  on public.coalition_join_requests (decided_by) where decided_by is not null;

create index if not exists coalition_join_requests_user_id_user_ref_idx
  on public.coalition_join_requests (user_id);

create index if not exists coalition_posts_author_id_user_ref_idx
  on public.coalition_posts (author_id);

create index if not exists coalition_resources_created_by_user_ref_idx
  on public.coalition_resources (created_by);

create index if not exists coalition_threads_author_id_user_ref_idx
  on public.coalition_threads (author_id);

create index if not exists content_reports_resolved_by_user_ref_idx
  on public.content_reports (resolved_by) where resolved_by is not null;

create index if not exists content_reports_target_owner_id_user_ref_idx
  on public.content_reports (target_owner_id) where target_owner_id is not null;

create index if not exists discord_integrations_added_by_user_id_user_ref_idx
  on public.discord_integrations (added_by_user_id) where added_by_user_id is not null;

create index if not exists dm_conversations_created_by_user_ref_idx
  on public.dm_conversations (created_by) where created_by is not null;

create index if not exists dm_conversations_session_key_sender_id_user_ref_idx
  on public.dm_conversations (session_key_sender_id) where session_key_sender_id is not null;

create index if not exists dm_messages_sender_id_user_ref_idx
  on public.dm_messages (sender_id);

create index if not exists dossiers_reviewed_by_user_ref_idx
  on public.dossiers (reviewed_by) where reviewed_by is not null;

create index if not exists editable_content_updated_by_user_ref_idx
  on public.editable_content (updated_by) where updated_by is not null;

create index if not exists editable_content_history_changed_by_user_ref_idx
  on public.editable_content_history (changed_by) where changed_by is not null;

create index if not exists email_deliveries_user_id_user_ref_idx
  on public.email_deliveries (user_id);

create index if not exists external_communities_created_by_user_ref_idx
  on public.external_communities (created_by) where created_by is not null;

create index if not exists feedback_replies_author_id_user_ref_idx
  on public.feedback_replies (author_id) where author_id is not null;

create index if not exists feedback_reports_resolved_by_user_ref_idx
  on public.feedback_reports (resolved_by) where resolved_by is not null;

create index if not exists feedback_reports_user_id_user_ref_idx
  on public.feedback_reports (user_id) where user_id is not null;

create index if not exists forum_communities_created_by_user_ref_idx
  on public.forum_communities (created_by) where created_by is not null;

create index if not exists forum_edits_editor_id_user_ref_idx
  on public.forum_edits (editor_id) where editor_id is not null;

create index if not exists forum_post_reports_reporter_id_user_ref_idx
  on public.forum_post_reports (reporter_id);

create index if not exists forum_post_reports_resolved_by_user_ref_idx
  on public.forum_post_reports (resolved_by) where resolved_by is not null;

create index if not exists forum_posts_author_id_user_ref_idx
  on public.forum_posts (author_id) where author_id is not null;

create index if not exists forum_threads_author_id_user_ref_idx
  on public.forum_threads (author_id) where author_id is not null;

create index if not exists kratom_stories_approved_by_user_ref_idx
  on public.kratom_stories (approved_by) where approved_by is not null;

create index if not exists leader_invites_invited_by_user_ref_idx
  on public.leader_invites (invited_by) where invited_by is not null;

create index if not exists legislator_events_created_by_user_ref_idx
  on public.legislator_events (created_by) where created_by is not null;

create index if not exists legislator_kratom_stance_last_updated_by_user_ref_idx
  on public.legislator_kratom_stance (last_updated_by) where last_updated_by is not null;

create index if not exists legislator_stance_last_updated_by_user_ref_idx
  on public.legislator_stance (last_updated_by) where last_updated_by is not null;

create index if not exists letter_screen_blocks_user_id_user_ref_idx
  on public.letter_screen_blocks (user_id);

create index if not exists library_items_added_by_user_ref_idx
  on public.library_items (added_by) where added_by is not null;

create index if not exists local_rep_requests_resolved_by_user_ref_idx
  on public.local_rep_requests (resolved_by) where resolved_by is not null;

create index if not exists municipal_meetings_broadcast_by_user_ref_idx
  on public.municipal_meetings (broadcast_by) where broadcast_by is not null;

create index if not exists municipal_meetings_moderation_reviewed_by_user_ref_idx
  on public.municipal_meetings (moderation_reviewed_by) where moderation_reviewed_by is not null;

create index if not exists news_items_flagged_by_user_ref_idx
  on public.news_items (flagged_by) where flagged_by is not null;

create index if not exists notifications_user_id_user_ref_idx
  on public.notifications (user_id);

create index if not exists partners_created_by_user_ref_idx
  on public.partners (created_by) where created_by is not null;

create index if not exists patch_notes_published_by_user_ref_idx
  on public.patch_notes (published_by) where published_by is not null;

create index if not exists policy_alerts_moderated_by_user_ref_idx
  on public.policy_alerts (moderated_by) where moderated_by is not null;

create index if not exists policy_alerts_submitted_by_user_id_user_ref_idx
  on public.policy_alerts (submitted_by_user_id) where submitted_by_user_id is not null;

create index if not exists profiles_vendor_approved_by_user_ref_idx
  on public.profiles (vendor_approved_by) where vendor_approved_by is not null;

create index if not exists research_papers_submitted_by_user_ref_idx
  on public.research_papers (submitted_by) where submitted_by is not null;

create index if not exists signup_email_queue_user_id_user_ref_idx
  on public.signup_email_queue (user_id) where user_id is not null;

create index if not exists site_config_updated_by_user_ref_idx
  on public.site_config (updated_by) where updated_by is not null;

create index if not exists site_settings_updated_by_user_ref_idx
  on public.site_settings (updated_by) where updated_by is not null;

create index if not exists state_capital_info_last_updated_by_user_ref_idx
  on public.state_capital_info (last_updated_by) where last_updated_by is not null;

create index if not exists state_status_confirmed_by_user_ref_idx
  on public.state_status (confirmed_by) where confirmed_by is not null;

create index if not exists user_saved_searches_user_id_user_ref_idx
  on public.user_saved_searches (user_id);

create index if not exists wall_posts_wall_owner_id_user_ref_idx
  on public.wall_posts (wall_owner_id);
