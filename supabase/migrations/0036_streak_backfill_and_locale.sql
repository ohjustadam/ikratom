-- ============================================================
-- 0036 — Streak backfill + profile locale
-- ============================================================

-- ── Locale on profiles ──────────────────────────────────────
-- Two-letter ISO 639-1 code. Default 'en'. Used by the i18n layer to
-- render localized strings without forcing logged-out users to pick.
alter table public.profiles
  add column if not exists locale text not null default 'en'
  check (locale in ('en','id','th','ms','vi','tl','es'));

-- ── Backfill action streaks ─────────────────────────────────
-- Trigger from migration 0034 only catches NEW campaign_actions inserts.
-- This backfills longest_streak_days + the latest streak from history.
-- Idempotent — safe to re-run.
do $$
declare
  v_user uuid;
  v_dates date[];
  v_today date;
  v_yesterday date;
  v_current int;
  v_longest int;
  v_run int;
  i int;
begin
  for v_user in
    select distinct user_id from public.campaign_actions where user_id is not null
  loop
    -- Distinct days, ascending
    select array_agg(distinct (sent_at at time zone 'utc')::date order by (sent_at at time zone 'utc')::date)
      into v_dates
      from public.campaign_actions
      where user_id = v_user;

    if v_dates is null or array_length(v_dates, 1) is null then continue; end if;

    v_longest := 0;
    v_run := 1;
    for i in 2..array_length(v_dates, 1) loop
      if v_dates[i] = v_dates[i-1] + 1 then
        v_run := v_run + 1;
      else
        if v_run > v_longest then v_longest := v_run; end if;
        v_run := 1;
      end if;
    end loop;
    if v_run > v_longest then v_longest := v_run; end if;

    -- Current streak: count back from the most recent date if it's today
    -- or yesterday; else 0.
    v_today := current_date;
    v_yesterday := current_date - 1;
    v_current := 0;
    if v_dates[array_length(v_dates,1)] = v_today or v_dates[array_length(v_dates,1)] = v_yesterday then
      v_current := 1;
      for i in reverse array_length(v_dates,1)-1 .. 1 loop
        if v_dates[i+1] = v_dates[i] + 1 then
          v_current := v_current + 1;
        else
          exit;
        end if;
      end loop;
    end if;

    update public.profiles
      set action_streak_days = v_current,
          longest_streak_days = greatest(longest_streak_days, v_longest),
          last_action_date = v_dates[array_length(v_dates, 1)]
      where id = v_user;
  end loop;
end $$;
