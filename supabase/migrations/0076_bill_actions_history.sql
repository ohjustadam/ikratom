-- ============================================================
-- 0076_bill_actions_history
--
-- Layer 1 of the real-time accuracy pipeline (TN SB 1656 lessons):
--
--   1. bill_actions table — full history, never overwritten. Every
--      sync writes each action as its own row, deduped on
--      (bill_id, action_date, description). bills.last_action stays
--      as a denormalized convenience for card-display.
--
--   2. critical_action_alert() trigger — fires on bill_actions INSERT.
--      Scans the description against ~25 keywords ("recommended for
--      passage", "passed", "substituted", "signed by governor", etc).
--      For an active anti bill, spawns a CRITICAL policy_alert. For
--      a pro bill, ALERT severity. Triggers the Phase 4 auto-campaign
--      cascade automatically.
--
--   3. Discord webhook fan-out — once policy_alert lands, the existing
--      notifyDiscordOnBillStatusChange path posts to integrated
--      Discord channels (test channel + any partner shops opted in).
--
-- Source-of-truth philosophy: append-only action log. Sync scripts
-- (LegiScan + OpenStates + state Capitol scrapers later) all write
-- here, dedupe via the unique constraint. The single trigger fires
-- regardless of which source detected the action — so news-triggered
-- hot-resync, daily AI verification, and routine cron sync all
-- converge on the same alert pathway.
--
-- ROLLBACK: drop the trigger; the table can stay populated.
-- ============================================================

-- ----------------------------------------
-- 1. The history table
-- ----------------------------------------
create table if not exists public.bill_actions (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  action_date date not null,
  description text not null,
  chamber text,
  source text not null,                       -- openstates | legiscan | tn_capitol | manual | gemini_verified
  raw_json jsonb,
  alert_spawned_id uuid references public.policy_alerts(id) on delete set null,
  created_at timestamptz not null default now(),
  -- One row per unique action. If multiple sources report the same
  -- action on the same date with the same description, the second
  -- write is a no-op (which is what we want).
  constraint bill_actions_unique unique (bill_id, action_date, description)
);

create index if not exists ix_bill_actions_bill_date
  on public.bill_actions (bill_id, action_date desc);
create index if not exists ix_bill_actions_recent
  on public.bill_actions (created_at desc);
create index if not exists ix_bill_actions_source
  on public.bill_actions (source, created_at desc);

-- RLS — same as bills (public read on active bills' actions)
alter table public.bill_actions enable row level security;
drop policy if exists bill_actions_public_read on public.bill_actions;
create policy bill_actions_public_read
  on public.bill_actions
  for select
  to public
  using (
    exists (select 1 from public.bills b where b.id = bill_id and b.active = true)
  );

drop policy if exists bill_actions_admin_all on public.bill_actions;
create policy bill_actions_admin_all
  on public.bill_actions
  for all
  to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- ----------------------------------------
-- 2. Critical-action keywords (config table, admin-editable)
-- ----------------------------------------
create table if not exists public.bill_action_keywords (
  id uuid primary key default gen_random_uuid(),
  pattern text not null,                  -- lowercase substring match
  severity text not null,                 -- 'critical' | 'alert' | 'watch'
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.bill_action_keywords enable row level security;
drop policy if exists bak_admin on public.bill_action_keywords;
create policy bak_admin on public.bill_action_keywords
  for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));
drop policy if exists bak_read on public.bill_action_keywords;
create policy bak_read on public.bill_action_keywords
  for select to public using (active);

-- Seed the keyword library. Severity here is the BASELINE — the
-- trigger then upgrades to 'critical' if the bill is anti, downgrades
-- to 'alert' if pro.
insert into public.bill_action_keywords (pattern, severity, description) values
  ('signed by governor',                'critical', 'Bill enacted as law'),
  ('signed into law',                   'critical', 'Bill enacted as law'),
  ('vetoed',                            'critical', 'Veto issued'),
  ('veto override',                     'critical', 'Veto override action'),
  ('passed senate',                     'critical', 'Senate passage'),
  ('passed house',                      'critical', 'House passage'),
  ('passed by',                         'critical', 'Chamber passage'),
  ('recommended for passage',           'alert',    'Committee favorable'),
  ('reported favorabl',                 'alert',    'Committee favorable'),
  ('companion house bill substituted',  'alert',    'Companion substituted (positioned for floor)'),
  ('companion senate bill substituted', 'alert',    'Companion substituted'),
  ('substituted',                       'alert',    'Bill substituted'),
  ('engrossed',                         'alert',    'Engrossed for transmission'),
  ('enrolled',                          'alert',    'Enrolled for signing'),
  ('transmitted to governor',           'critical', 'On governor''s desk'),
  ('placed on senate regular calendar', 'alert',    'Scheduled for Senate floor'),
  ('placed on house regular calendar',  'alert',    'Scheduled for House floor'),
  ('scheduled for floor',               'alert',    'Floor vote scheduled'),
  ('died in committee',                 'watch',    'Bill died'),
  ('died in chamber',                   'watch',    'Bill died'),
  ('withdrawn',                         'watch',    'Bill withdrawn'),
  ('effective date',                    'alert',    'Effective date set'),
  ('signed by senate speaker',          'alert',    'Senate Speaker signed'),
  ('signed by h. speaker',              'alert',    'House Speaker signed'),
  ('signed by house speaker',           'alert',    'House Speaker signed'),
  ('first consideration',               'watch',    'Introduced'),
  ('referred to committee',             'watch',    'Committee referral')
on conflict do nothing;

-- ----------------------------------------
-- 3. The trigger
-- ----------------------------------------
-- Fires on bill_actions INSERT. For matching keywords AND active anti/pro
-- bills, auto-spawns a policy_alert with severity adjusted to the bill's
-- stance. Records the spawned alert ID back into bill_actions for audit.
-- ----------------------------------------
create or replace function public.critical_action_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill public.bills%rowtype;
  v_match record;
  v_severity text;
  v_action_required boolean;
  v_alert_id uuid;
  v_desc_lower text;
  v_title_clean text;
begin
  -- Look up the bill — skip if missing or inactive
  select * into v_bill from public.bills where id = new.bill_id;
  if not found then return new; end if;
  if not v_bill.active then return new; end if;

  v_desc_lower := lower(new.description);

  -- Find the highest-severity matching keyword
  select * into v_match
    from public.bill_action_keywords
   where active
     and v_desc_lower like '%' || pattern || '%'
   order by case severity when 'critical' then 3 when 'alert' then 2 else 1 end desc
   limit 1;

  -- No match → not a critical action, exit quietly
  if not found then return new; end if;

  -- Adjust severity by bill stance:
  --   anti bill + critical keyword → critical (full siren)
  --   anti bill + alert keyword    → alert
  --   pro bill  + critical keyword → alert (we still care, but it's the good guys winning)
  --   pro bill  + alert keyword    → watch
  --   neutral   + anything         → watch (informational only)
  v_severity := case
    when v_bill.kratom_relevance = 'anti'  and v_match.severity = 'critical' then 'critical'
    when v_bill.kratom_relevance = 'anti'  and v_match.severity = 'alert'    then 'alert'
    when v_bill.kratom_relevance = 'pro'   and v_match.severity = 'critical' then 'alert'
    when v_bill.kratom_relevance = 'pro'   and v_match.severity = 'alert'    then 'watch'
    else 'watch'
  end;

  -- action_required = true ONLY for anti bills (advocates need to mobilize).
  -- pro bills get notification but no auto-campaign spawn.
  v_action_required := (v_bill.kratom_relevance = 'anti'
                        and v_match.severity in ('critical', 'alert'));

  -- Clean up the title for the alert headline
  v_title_clean := v_bill.state || ' ' || v_bill.bill_number;

  -- Insert the alert. The Phase 4 trigger then fires (if action_required)
  -- and the auto-campaign chain takes over from there.
  insert into public.policy_alerts (
    kind, severity, title, body, locality, source_url, bill_id,
    action_required, moderation_status, occurs_at
  ) values (
    'bill_event',
    v_severity,
    v_title_clean || ' — ' || new.description,
    'Bill ' || v_title_clean || ' had a tracked critical action on ' ||
      to_char(new.action_date, 'YYYY-MM-DD') || ': ' || new.description ||
      coalesce(E'\n\nSource: ' || new.source, '') ||
      coalesce(E'\n\nBill: ' || v_bill.title, ''),
    coalesce(v_bill.state, 'ALL'),
    v_bill.source_url,
    v_bill.id,
    v_action_required,
    'approved',
    new.action_date::timestamptz
  )
  returning id into v_alert_id;

  -- Stamp the action row with the alert it spawned (for audit + dedupe)
  update public.bill_actions
     set alert_spawned_id = v_alert_id
   where id = new.id;

  return new;
exception
  when others then
    raise warning 'critical_action_alert failed for action %: %', new.id, sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_critical_action_alert on public.bill_actions;
create trigger trg_critical_action_alert
  after insert
  on public.bill_actions
  for each row
  execute function public.critical_action_alert();

comment on trigger trg_critical_action_alert on public.bill_actions is
  'Real-time alert pathway for tracked bill action history. Scans description against bill_action_keywords; severity adjusted by bill.kratom_relevance. Anti bills trigger action_required→ auto-campaign. See migration 0076.';

-- ----------------------------------------
-- 4. Helper view: latest action per bill (for /admin/intel-health)
-- ----------------------------------------
create or replace view public.bill_actions_latest as
  select distinct on (bill_id)
         bill_id, action_date, description, source, alert_spawned_id, created_at
    from public.bill_actions
   order by bill_id, action_date desc, created_at desc;
