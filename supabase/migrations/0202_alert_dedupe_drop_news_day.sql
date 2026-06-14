-- ============================================================
-- 0202_alert_dedupe_drop_news_day
--
-- INTENT
-- The news-story branch of compute_policy_alert_dedupe_key (0079) keyed on
--   'news:{normalized-title}:{locality}:{YYYY-MM-DD}'
-- The trailing day means a syndicated story re-published a day or two later
-- gets a DIFFERENT key and slips past the ux_policy_alerts_dedupe_approved
-- unique index → the same story spawns multiple alerts and shows up repeatedly
-- on /pulse. (Observed: a TN ban story = 13 alerts; an NC under-21 bill = 6;
-- Marshall IL = 6; MO AG = 5. The news_items layer dedups by duplicate_of, but
-- the alert layer didn't.)
--
-- A bill ACTION on two different days IS two different events, so the
-- 'bill:{bill_id}:{day}' branch (and bop:/stale:/intel:/fallback) KEEP the day.
-- Only the news-story branch drops it, so re-publishes of one story collapse to
-- a single alert regardless of when each outlet runs it. The 60-char normalized
-- title + locality is specific enough that genuinely distinct events keep
-- distinct keys.
--
-- This migration only REDEFINES the key function (go-forward for new inserts).
-- Existing duplicate alerts are collapsed separately by the owner-gated
-- scripts/merge-duplicate-alerts.mjs (dry-run + --apply), which also rewrites
-- existing canonical keys to the new day-less form so future re-publishes of an
-- already-alerted story collide too.
--
-- ROLLBACK: re-apply 0079's compute_policy_alert_dedupe_key definition.
-- ============================================================

create or replace function public.compute_policy_alert_dedupe_key(p_alert public.policy_alerts)
returns text
language plpgsql
immutable
as $$
declare
  v_day text;
  v_norm text;
begin
  v_day := to_char(coalesce(p_alert.occurs_at, p_alert.created_at, now()), 'YYYY-MM-DD');

  -- Bill-event with linked bill: pin to the bill+day. Multiple actions
  -- on the same day for the same bill collapse to one alert; different
  -- days are genuinely different actions, so the day STAYS here.
  if p_alert.kind = 'bill_event' and p_alert.bill_id is not null then
    return 'bill:' || p_alert.bill_id::text || ':' || v_day;
  end if;

  -- News-story branch: key on (normalized_title, locality) with NO day, so a
  -- syndicated story re-published across multiple days collapses to one alert.
  if p_alert.kind in ('news_break', 'bill_event', 'fda_action', 'dea_action') then
    v_norm := public.normalize_news_title(p_alert.title);
    if v_norm is not null and length(v_norm) > 8 then
      return 'news:' || v_norm || ':' || coalesce(p_alert.locality, 'ALL');
    end if;
  end if;

  -- Intel tip: (submitter, day, title-prefix)
  if p_alert.kind = 'intel_tip' then
    return 'intel:' || coalesce(p_alert.submitted_by_user_id::text, 'anon')
      || ':' || v_day || ':' || left(public.normalize_news_title(p_alert.title), 30);
  end if;

  -- Scraper-stale: per bill+day
  if p_alert.kind = 'scraper_stale' and p_alert.bill_id is not null then
    return 'stale:' || p_alert.bill_id::text || ':' || v_day;
  end if;

  -- BoP hearing: per board+day
  if p_alert.kind = 'bop_hearing' and p_alert.bop_board_id is not null then
    return 'bop:' || p_alert.bop_board_id::text || ':' || v_day;
  end if;

  -- Fallback: (kind, locality, day, md5-title-prefix)
  return 'k:' || p_alert.kind
    || ':' || coalesce(p_alert.locality, 'ALL')
    || ':' || v_day
    || ':' || substring(md5(coalesce(p_alert.title, '')), 1, 8);
end;
$$;

comment on column public.policy_alerts.dedupe_key is
  'Deterministic key. News-story branch is (kind+title+locality), NO day (0202) so re-publishes collapse; bill/bop/stale/intel branches keep the day. Unique partial index on approved rows prevents duplicates. See migrations 0079 + 0202.';
