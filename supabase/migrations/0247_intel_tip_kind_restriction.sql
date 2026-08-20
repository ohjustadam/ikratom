-- RENUMBERED 0246 -> 0247 on 2026-08-20. `0246` was taken by
-- 0246_permission_catalog_v2.sql, which merged in #847 and is ALREADY APPLIED
-- to production. `npm run db:push` keys on filename, so two different 0246 files
-- across two branches is a live drift hazard: whichever ran first would make the
-- other look applied. Nothing about this migration's contents changed.

-- ============================================================
-- 0246 — Restrict trusted_reporter self-publish to kind='intel_tip'
-- ============================================================
-- Audit finding (LOW, authz/rls-capability-creep): the trusted-reporter
-- self-insert policy on policy_alerts (0235_intel_tip_anonymity_fix.sql:54)
-- lets a profiles.intel_tier='trusted_reporter' user INSERT an APPROVED row
-- directly onto the public /pulse feed — but, unlike its sibling
-- policy_alerts_self_submit (which constrains kind='intel_tip' AND
-- moderation_status='pending'), it has NO `kind` constraint. RLS policies are
-- permissive (OR'd), so a trusted_reporter could self-publish an APPROVED alert
-- of ANY kind (e.g. an internal/system kind like 'scraper_stale') at any
-- severity, bypassing the intel-tip categorization + moderation intent.
--
-- intel_tier is admin-assigned (self-escalation blocked by the 0212/0213
-- owner-flag guard), so this needs an already-vetted account — hence LOW — but
-- it is broader write authority than the tier was scoped for. This re-creates
-- the policy with `kind = 'intel_tip'` added to the WITH CHECK, matching the
-- sibling policy + the app's only usage of this path (the intel-tip submit form).
--
-- NOT YET APPLIED to prod — apply via `npm run db:push` after owner review.
-- Rollback: restore the 0235 version of policy_alerts_trusted_self_submit
-- (without the kind clause).

drop policy if exists policy_alerts_trusted_self_submit on public.policy_alerts;
create policy policy_alerts_trusted_self_submit on public.policy_alerts
  for insert to authenticated
  with check (
    kind = 'intel_tip'
    and (
      submitted_by_user_id = auth.uid()
      or (is_anonymous = true and submitted_by_user_id is null)
    )
    and moderation_status = 'approved'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.intel_tier = 'trusted_reporter'
    )
  );
