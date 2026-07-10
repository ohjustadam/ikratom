-- ============================================================
-- 0235 — CRITICAL: stop de-anonymizing "anonymous" intel tips
-- ============================================================
-- Security audit 2026-07-10, finding #1 (CRITICAL, adversarially verified).
--
-- policy_alerts_read_approved (0062:96) is `FOR SELECT TO public USING
-- (moderation_status='approved')` — whole-row, no column restriction — so any
-- visitor using the browser anon key can
--   select submitted_by_user_id, is_anonymous from policy_alerts
--   where moderation_status='approved' and is_anonymous=true
-- and then feed each id to the public get_public_profile RPC to resolve the
-- reporter's @username. That unmasks whistleblowers who explicitly chose
-- anonymity — a direct breach of the platform's paramount anonymity rule.
--
-- Root cause: the /alerts/submit path (src/modules/alerts/actions.ts) ALWAYS
-- stored submitted_by_user_id even when is_anonymous=true (unlike the sibling
-- bill-intel path, which nulls it). But the RLS insert policies REQUIRE
-- submitted_by_user_id = auth.uid(), so it could not simply be nulled without
-- this policy change.
--
-- Fix (three parts; code change ships alongside):
--   1. Allow an anonymous self-insert to carry a NULL submitter: extend the two
--      insert policies' WITH CHECK with `OR (is_anonymous AND submitted_by IS NULL)`.
--      (A user still cannot attribute a tip to anyone else — submitter is self or null.)
--   2. Backfill: null submitted_by_user_id on existing approved/pending anonymous
--      rows so already-stored reporter ids stop leaking. (Irreversible — but an
--      anonymous tip should never have carried the id.)
--   3. Code: submitIntelTip stores submitted_by_user_id = is_anonymous ? null : user.id.
--
-- NOTE (follow-up, not this migration): submitted_by_user_id is still readable on
-- the public surface for NON-anonymous approved tips. Those reporters did not opt
-- into anonymity, and the column is needed by admin moderation + the author's own
-- "my tips" list, so hiding it cleanly needs a submitter-less public VIEW (like
-- public_call_intel) — tracked as a defense-in-depth follow-up.
--
-- Rollback: restore the two policies' original WITH CHECK (drop the OR clause).
-- The backfill cannot be rolled back (ids are gone by design).

-- ---- 1. Allow anonymous (null-submitter) self-inserts ----
drop policy if exists policy_alerts_self_submit on public.policy_alerts;
create policy policy_alerts_self_submit
  on public.policy_alerts
  for insert
  to authenticated
  with check (
    kind = 'intel_tip'
    and moderation_status = 'pending'
    and (
      submitted_by_user_id = auth.uid()
      or (is_anonymous = true and submitted_by_user_id is null)
    )
  );

drop policy if exists policy_alerts_trusted_self_submit on public.policy_alerts;
create policy policy_alerts_trusted_self_submit
  on public.policy_alerts
  for insert
  to authenticated
  with check (
    (
      submitted_by_user_id = auth.uid()
      or (is_anonymous = true and submitted_by_user_id is null)
    )
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and p.intel_tier = 'trusted_reporter'
    )
  );

-- ---- 2. Backfill: scrub reporter ids off already-stored anonymous tips ----
update public.policy_alerts
   set submitted_by_user_id = null
 where is_anonymous = true
   and submitted_by_user_id is not null;
