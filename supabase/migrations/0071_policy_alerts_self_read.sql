-- ============================================================
-- 0071_policy_alerts_self_read
--
-- Let users read their own submitted policy_alerts regardless of
-- moderation_status, so /alerts/my-tips can show pending + rejected
-- submissions (currently RLS only allows reading approved rows).
--
-- Existing policies:
--   policy_alerts_read_approved   — public select where moderation_status='approved'
--   policy_alerts_admin_all       — admin all
--   policy_alerts_self_submit     — authed insert for kind=intel_tip + pending
--   policy_alerts_trusted_self_submit (0069) — trusted reporter pre-approved insert
-- ============================================================

drop policy if exists policy_alerts_self_read on public.policy_alerts;
create policy policy_alerts_self_read
  on public.policy_alerts
  for select
  to authenticated
  using (submitted_by_user_id = auth.uid());
