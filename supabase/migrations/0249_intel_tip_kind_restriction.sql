-- RENUMBERED 0246 -> 0247 (2026-08-20) -> 0249 (2026-08-28).
-- `npm run db:push` keys on FILENAME, so a duplicate number across two branches
-- is a live drift hazard: whichever ran first would make the other look applied.
-- 0246 went to permission_catalog_v2 (#847). While this branch sat unmerged,
-- main also took 0247_username_guarantee and 0248_campaign_send_batches, so the
-- 2026-08-20 renumber collided again. 0249 is the next free number.
--
-- Intent: restrict trusted-reporter self-publish to the intel tip kinds that are
-- safe to auto-publish, and fix two dead links (/intel/submit, /meetings).
-- Rollback: drop the constraint added below.

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
