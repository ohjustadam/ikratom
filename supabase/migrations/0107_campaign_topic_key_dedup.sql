-- 0107: Campaign topic-key + dedup gate for auto-generated campaigns.
--
-- Problem: trg_auto_campaign_on_alert fires once per policy_alert, and
-- multiple news articles about the same event create multiple alerts
-- → multiple campaigns. Admin pending queue accumulates 1000+ items
-- representing maybe 100 distinct events.
--
-- Solution: add a deterministic "topic_key" to each campaign — a short
-- string that captures (state, kratom_keyword, event_word) so two
-- campaigns about the same underlying policy event get the same key.
-- Add a partial unique constraint preventing more than one
-- pending_review OR active campaign with the same topic_key. Older
-- inserts that would collide get caught by the trigger and routed to
-- the existing campaign instead of inserted as new.
--
-- The trg_auto_campaign_on_alert trigger and the auto-campaign-from-alert
-- script both need updating to handle the unique-violation gracefully
-- by linking the policy_alert to the existing canonical campaign.
--
-- NOTE (corrected in 0186): this function's keyword+event lists are NARROWER than
-- the broad EVENT_RX in scripts/lib/topic-key.mjs (the daily janitor's topicKey)
-- and differ from the engine's strongTopicKey set — the three dedup keyspaces are
-- intentionally distinct (see docs/DECISIONS.md "Campaign dedup uses THREE
-- keyspaces"). The original claim that these lists "match cleanup-pending-
-- campaigns.mjs" no longer holds. Migration 0186 makes this function bill-number-
-- aware to match the engine's billKey on the one axis where divergence caused
-- real over-merges.
--
-- Rollback:
--   DROP INDEX IF EXISTS ux_campaigns_topic_key_live;
--   ALTER TABLE campaigns DROP COLUMN IF EXISTS topic_key;
--   DROP FUNCTION IF EXISTS public.campaign_topic_key(text, text);

-- ----------------------------------------
-- 1. Topic-key function (immutable so it can be used in indexes)
-- ----------------------------------------
create or replace function public.campaign_topic_key(p_state text, p_title text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
  kw text := 'unknown';
  ev text := 'unknown';
begin
  if p_title is null then return null; end if;
  t := lower(regexp_replace(p_title, '[^a-z0-9 ]', ' ', 'gi'));
  t := regexp_replace(t, '\s+', ' ', 'g');

  -- Keyword detection — order matters (longest first to avoid prefix collision).
  -- Mirrors scripts/lib/kratom-keywords.mjs.
  if t ~* '\m7-?hydroxymitragynine\M' then kw := 'mitragynine';
  elsif t ~* '\mmitragyn[a-z]*\M' then kw := 'mitragyna';
  elsif t ~* '\m7-?o?h\M' then kw := 'mitragynine';
  elsif t ~* '\mkratomite\M' then kw := 'kratom';
  elsif t ~* '\mkratoms?\M' then kw := 'kratom';
  elsif t ~* '\mgas[- ]?station\M' then kw := 'gas-station';
  elsif t ~* '\mtianeptine\M' then kw := 'tianeptine';
  end if;

  -- Event detection — what's happening to it.
  if t ~* '\mban' then ev := 'ban';
  elsif t ~* '\mrestrict' then ev := 'restrict';
  elsif t ~* '\mregulat' then ev := 'regulat';
  elsif t ~* '\mhearing' then ev := 'hearing';
  elsif t ~* '\mschedul' then ev := 'schedule';
  elsif t ~* '\menact' then ev := 'enact';
  elsif t ~* '\mveto' then ev := 'veto';
  elsif t ~* '\mrepeal' then ev := 'repeal';
  elsif t ~* '\mordinance' then ev := 'ordinance';
  elsif t ~* '\mcrackdown' then ev := 'crackdown';
  elsif t ~* '\mlaw\M' then ev := 'law';
  elsif t ~* '\mruling' then ev := 'ruling';
  elsif t ~* '\mpass(es|ed)?' then ev := 'pass';
  elsif t ~* '\msign(s|ed)?' then ev := 'sign';
  elsif t ~* '\mapprov' then ev := 'approve';
  elsif t ~* '\mreject' then ev := 'reject';
  elsif t ~* '\mwithdraw' then ev := 'withdraw';
  elsif t ~* '\mstall' then ev := 'stall';
  elsif t ~* '\mhalt' then ev := 'halt';
  end if;

  return coalesce(p_state, '?') || '|' || kw || '|' || ev;
end;
$$;

comment on function public.campaign_topic_key is
  'Deterministic topic cluster key for campaigns. Two campaigns about the same underlying policy event produce the same key (e.g. TN|kratom|ban). Used by ux_campaigns_topic_key_live to prevent duplicate pending+active campaigns for the same event.';

-- ----------------------------------------
-- 2. Topic-key column + back-fill
-- ----------------------------------------
alter table public.campaigns
  add column if not exists topic_key text;

-- Back-fill every existing row
update public.campaigns
   set topic_key = public.campaign_topic_key(state, title)
 where topic_key is null;

-- ----------------------------------------
-- 3. Trigger to keep topic_key in sync on insert/update
-- ----------------------------------------
create or replace function public.campaigns_set_topic_key()
returns trigger
language plpgsql
as $$
begin
  if new.topic_key is null or new.topic_key = '' then
    new.topic_key := public.campaign_topic_key(new.state, new.title);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_campaigns_set_topic_key on public.campaigns;
create trigger trg_campaigns_set_topic_key
  before insert or update of title, state
  on public.campaigns
  for each row
  execute function public.campaigns_set_topic_key();

-- ----------------------------------------
-- 4. Partial unique index — DEFERRED to migration 0108.
--    Adding it here would fail because the back-fill produces some
--    live/pending duplicates that need a one-shot collapse first
--    (scripts/cleanup-pending-campaigns.mjs --use-sql-key). Migration
--    0108 adds the index after that cleanup runs.
-- ----------------------------------------
