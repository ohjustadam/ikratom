-- 0258_email_on_by_default.sql
--
-- WHY (2026-10-03): notification_preferences.email defaulted to FALSE since
-- 0008, and nothing ever asked members to turn it on — all 46 rows were false,
-- and only one member had changed ANY notification setting. Push reaches 7 of
-- 46 members, so for most people nothing reached them outside the site. The
-- owner chose email-on with a clear opt-out (2026-10-03): the launch email
-- explains it, and every email carries a one-click unsubscribe
-- (/api/email/unsubscribe) plus a settings link.
--
-- Members who turned notifications fully OFF (digest = 'off') are left alone:
-- that was an explicit choice and the sender also honours it.
--
-- NUMBERING: 0252-0257 belong to PR #941 (already applied in production, not yet
-- merged), so this is 0258 to avoid a collision.
--
-- ROLLBACK (exact: only the rows this migration flipped):
--   alter table public.notification_preferences alter column email set default false;
--   update public.notification_preferences set email = false
--    where user_id in (select jsonb_array_elements_text(details->'user_ids')::uuid
--                        from public.admin_audit_log where action = 'email_default_on_backfill');

alter table public.notification_preferences alter column email set default true;

with flipped as (
  update public.notification_preferences
     set email = true, updated_at = now()
   where email = false
     and coalesce(digest, 'instant') <> 'off'
  returning user_id
)
insert into public.admin_audit_log (actor_id, action, target_type, details)
select null, 'email_default_on_backfill', 'notification_preferences',
       jsonb_build_object('migration', '0258', 'user_ids', coalesce(jsonb_agg(user_id), '[]'::jsonb))
  from flipped;
