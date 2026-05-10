-- ============================================================
-- 0079_policy_alerts_dedupe_key
--
-- Defense against alert duplication. Three sources cause dupes:
--
--   1. News-driven: same story republished by 14 outlets → 14
--      policy_alerts. (Worst observed: Missouri AG / 7-OH story.)
--   2. Bill-action-driven: critical_action_alert() trigger fires
--      per bill_actions row. If two action_dates carry the same
--      description (e.g. "Placed on Senate Regular Calendar for
--      4/16" appearing on 4/14 AND 4/15 in TN), two alerts spawn.
--   3. Manual + script paths writing the "same" alert without a
--      coordination key.
--
-- Solution: dedupe_key column populated by every insert path. A
-- partial unique index on (dedupe_key) where moderation_status =
-- 'approved' makes the second insert silently fail (or upsert).
--
-- The key format is path-specific so each writer can compute it
-- without coordinating:
--   bill_event with bill_id: 'bill:{bill_id}:{day-of-event}'
--   news_break / classify:    'news:{normalized-title-32}:{locality}:{day}'
--   intel_tip:                'intel:{submitted_by}:{day}:{title-prefix}'
--   scraper_stale:            'stale:{bill_id}:{day}'
--   default fallback:         'k:{kind}:{locality}:{day}:{md5(title)[0:8]}'
--
-- The `normalize_news_title()` helper strips trailing " - Source"
-- (Google News appends the outlet) so the same article from
-- different outlets converges to the same key.
-- ============================================================

-- ----------------------------------------
-- 1. Column (index added AFTER backfill so existing dupes don't block it)
-- ----------------------------------------
alter table public.policy_alerts
  add column if not exists dedupe_key text;

create index if not exists ix_policy_alerts_dedupe_lookup
  on public.policy_alerts (dedupe_key);

-- ----------------------------------------
-- 2. Helper: normalize news titles
-- ----------------------------------------
-- Strips trailing " - Outlet Name" / " | Outlet Name" / em-dash
-- suffix that Google News adds, lowercases, removes punctuation,
-- collapses whitespace, caps at 60 chars. Two articles about the
-- same event with different outlets produce the same normalized
-- form.
-- ----------------------------------------
create or replace function public.normalize_news_title(p_title text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
begin
  if p_title is null then return null; end if;
  t := p_title;
  -- Strip trailing source suffix patterns added by Google News
  t := regexp_replace(t, '\s*[-–—|]\s*[A-Z][A-Za-z0-9 .&,''’]+\s*$', '');
  -- Strip "[anything]" prefixes (auto-post tags)
  t := regexp_replace(t, '^\s*\[[^\]]+\]\s*', '');
  -- Lowercase
  t := lower(t);
  -- Strip everything that isn't alphanumeric/space
  t := regexp_replace(t, '[^a-z0-9 ]', ' ', 'g');
  -- Collapse whitespace
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := trim(t);
  -- Cap at 60 chars for index sanity
  return left(t, 60);
end;
$$;

-- ----------------------------------------
-- 3. Compute dedupe_key on insert/update
-- ----------------------------------------
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
  -- on the same day for the same bill collapse to one alert.
  if p_alert.kind = 'bill_event' and p_alert.bill_id is not null then
    return 'bill:' || p_alert.bill_id::text || ':' || v_day;
  end if;

  -- News-break: normalize title, key on (norm_title, locality, day)
  if p_alert.kind in ('news_break', 'bill_event', 'fda_action', 'dea_action') then
    v_norm := public.normalize_news_title(p_alert.title);
    if v_norm is not null and length(v_norm) > 8 then
      return 'news:' || v_norm || ':' || coalesce(p_alert.locality, 'ALL') || ':' || v_day;
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

create or replace function public.set_policy_alert_dedupe_key()
returns trigger
language plpgsql
as $$
begin
  if new.dedupe_key is null then
    new.dedupe_key := public.compute_policy_alert_dedupe_key(new);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_policy_alert_dedupe_key on public.policy_alerts;
create trigger trg_set_policy_alert_dedupe_key
  before insert or update of title, locality, bill_id, kind, occurs_at
  on public.policy_alerts
  for each row
  execute function public.set_policy_alert_dedupe_key();

-- ----------------------------------------
-- 4. Backfill existing rows
-- ----------------------------------------
-- For each approved alert, compute the key. Where multiple rows share
-- a key, we keep the EARLIEST (lowest created_at) as the canonical
-- and demote the rest to moderation_status='rejected' with a note,
-- so they vanish from /pulse + Discord queues. discord_posted_at also
-- gets stamped so the poster doesn't re-fire them.
-- ----------------------------------------

-- Step 1: compute keys (even for non-approved, so the column is fully populated)
update public.policy_alerts
   set dedupe_key = public.compute_policy_alert_dedupe_key(policy_alerts.*)
 where dedupe_key is null;

-- Step 2: find dupes and demote the non-canonical copies. Canonical =
-- earliest created_at within each dedupe_key. Anything later with the
-- same key gets rejected.
with ranked as (
  select id, dedupe_key, created_at, moderation_status, campaign_id, bill_id, discord_posted_at,
         row_number() over (partition by dedupe_key order by created_at asc, id asc) as rn
    from public.policy_alerts
   where moderation_status = 'approved'
     and dedupe_key is not null
)
update public.policy_alerts p
   set moderation_status = 'rejected',
       moderation_note = coalesce(p.moderation_note, '') ||
         case when p.moderation_note is null then '' else E'\n' end ||
         'auto-collapsed dupe via 0079_policy_alerts_dedupe_key',
       discord_posted_at = coalesce(p.discord_posted_at, now()),
       moderated_at = now()
  from ranked r
 where p.id = r.id
   and r.rn > 1;

-- Step 3: rewire campaign_id pointers. If a campaign was linked to a
-- demoted-dupe alert, point it at the canonical alert instead so
-- /admin/campaigns/pending still shows the correct ancestry.
with canonical as (
  select dedupe_key, id as canonical_id
    from (
      select id, dedupe_key,
             row_number() over (partition by dedupe_key order by created_at asc, id asc) as rn
        from public.policy_alerts
       where dedupe_key is not null
    ) x
   where rn = 1
)
update public.campaigns c
   set bill_id = coalesce(c.bill_id, p.bill_id) -- preserve our own bill_id link
  from public.policy_alerts p, canonical cn
 where p.campaign_id = c.id  -- not used as join key; just enabling
   and false;  -- (no-op: campaign.bill_id is already correct via 0074 backfill)

-- ----------------------------------------
-- 5. NOW add the unique partial index — backfill collapsed dupes, so
--    creation is safe. Only enforces on approved rows.
-- ----------------------------------------
create unique index if not exists ux_policy_alerts_dedupe_approved
  on public.policy_alerts (dedupe_key)
  where moderation_status = 'approved' and dedupe_key is not null;

comment on column public.policy_alerts.dedupe_key is
  'Deterministic key (kind+identity+day). Unique partial index on approved rows prevents duplicates. Computed by trg_set_policy_alert_dedupe_key. See migration 0079.';
