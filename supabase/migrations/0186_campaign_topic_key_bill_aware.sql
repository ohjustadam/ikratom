-- 0186: Make campaign_topic_key() bill-number-aware (align the DB dedup key with
--       the auto-approve engine's billKey on the one axis where divergence caused
--       real over-merges).
--
-- Problem (documented in docs/DECISIONS.md "Campaign dedup uses THREE keyspaces"):
--   campaign_topic_key() (migration 0107) keys only by STATE|kw|event and has NO
--   bill-number awareness. Two genuinely-distinct bills in the same state both
--   phrased as e.g. "kratom ban" collapse to one DB cluster at insert (the second
--   alert is linked to the first by the ux_campaigns_topic_key_live unique index),
--   even though the engine's billKey (scripts/lib/topic-key.mjs) would keep them
--   apart. The over-merge bites news-style titles that carry BOTH a keyword and a
--   strong event; keyword-free procedural step alerts fell in the DB's
--   |unknown|unknown blind spot and were separated by the engine instead.
--
-- Fix: when the title parses a bill number, key it as `bill:ST|<chamber><num>`
--   (identical to scripts/lib/topic-key.mjs billKey) so every step of ONE bill
--   collapses while DISTINCT bills stay distinct. Non-bill titles keep the exact
--   0107 STATE|kw|event behavior, unchanged. `bill:` keys do NOT end in
--   |unknown|unknown, so the existing ux_campaigns_topic_key_live index enforces
--   them with no index change.
--
-- DEPENDENCY: 0183 (auto_campaign_on_alert's 23505 auto-link) is ALREADY applied
--   to prod (migrations are current through 0185). That matters because making
--   keyword-free bill-step alerts collide at insert (they didn't before, being
--   |unknown|unknown) relies on the trigger catching the unique-violation and
--   linking the new alert to the canonical campaign instead of erroring. With 0183
--   live, that holds. 0186 is the only pending migration; db:push applies just it.
--
-- BACK-FILL is non-destructive and CANNOT fail: non-live rows are bulk-updated
--   (they're outside the partial unique index); live rows are updated oldest-first
--   row-by-row, and any row whose new key would collide with a live sibling keeps
--   its OLD key (status quo — the existing cleanup crons / engine collapse the
--   duplicate later). The earliest row in a colliding cluster wins the canonical
--   bill key. No campaign is superseded or deleted here. (Verified pre-apply:
--   scripts/diagnose-topic-key-0186.mjs — 7 existing multi-step bill clusters,
--   all handled by the keep-old-key path.)
--
-- Rollback:
--   1. Re-apply the migration 0107 campaign_topic_key() body (verbatim).
--   2. (optional) restore STATE|kw|event keys (safe — old key space is coarser):
--        update public.campaigns set topic_key = public.campaign_topic_key(state, title);

-- ----------------------------------------
-- 1. Bill-aware topic-key function (still immutable → index-usable)
-- ----------------------------------------
create or replace function public.campaign_topic_key(p_state text, p_title text)
returns text
language plpgsql
immutable
as $$
declare
  t text;
  m text[];
  kw text := 'unknown';
  ev text := 'unknown';
begin
  if p_title is null then return null; end if;

  -- Bill-identifier key (mirrors scripts/lib/topic-key.mjs billKey). Runs on the
  -- RAW title (not the alnum-stripped form) so "TX HB 1097 — …" → bill:TX|hb1097.
  -- Leading zeros are stripped (0* outside the captured digits), so HB 0301 → hb301.
  m := regexp_match(
    p_title,
    '\y(?:([a-z]{2})\s+)?(hb|sb|hr|sr|hcr|scr|hjr|sjr|hjm|sjm|ab|sf|hf|lb|ld|sp|hp)\s*\.?\s*0*(\d{1,5})\y',
    'i'
  );
  if m is not null then
    return 'bill:' || upper(coalesce(p_state, m[1], '')) || '|' || lower(m[2]) || m[3];
  end if;

  -- No bill number → exact 0107 behavior (STATE|kw|event).
  t := lower(regexp_replace(p_title, '[^a-z0-9 ]', ' ', 'gi'));
  t := regexp_replace(t, '\s+', ' ', 'g');

  -- Keyword detection — order matters (longest first to avoid prefix collision).
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
  'Deterministic topic cluster key for campaigns. Bill-numbered titles → bill:ST|<chamber><num> (mirrors scripts/lib/topic-key.mjs billKey, added in 0186); otherwise STATE|kw|event (0107). Used by ux_campaigns_topic_key_live to prevent duplicate live campaigns for the same event/bill. See docs/DECISIONS.md "Campaign dedup uses THREE keyspaces".';

-- ----------------------------------------
-- 2. Non-destructive back-fill of topic_key under the new function
-- ----------------------------------------
-- 2a. Non-live rows: outside the partial unique index → bulk update is always safe.
update public.campaigns
   set topic_key = public.campaign_topic_key(state, title)
 where review_state not in ('pending_review', 'auto_active', 'manual')
   and topic_key is distinct from public.campaign_topic_key(state, title);

-- 2b. Live rows: update oldest-first; a row whose new key collides with a live
--     sibling keeps its OLD key (the earliest row wins the canonical bill key).
--     Updating only topic_key does NOT fire trg_campaigns_set_topic_key (that
--     trigger watches title/state), so the explicit value sticks.
do $$
declare
  r record;
  newkey text;
  v_skipped int := 0;
begin
  for r in
    select id, state, title, topic_key
      from public.campaigns
     where review_state in ('pending_review', 'auto_active', 'manual')
     order by created_at asc
  loop
    newkey := public.campaign_topic_key(r.state, r.title);
    if newkey is not distinct from r.topic_key then
      continue; -- unchanged (e.g. non-bill title)
    end if;
    begin
      update public.campaigns set topic_key = newkey where id = r.id;
    exception when unique_violation then
      v_skipped := v_skipped + 1;
      raise notice '0186 back-fill: kept old key for campaign % (new key % already live)', r.id, newkey;
    end;
  end loop;
  raise notice '0186 back-fill complete: % live row(s) kept their old key due to a collision (existing cleanup/engine will collapse those).', v_skipped;
end $$;
