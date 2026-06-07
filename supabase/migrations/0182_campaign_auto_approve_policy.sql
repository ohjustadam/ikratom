-- 0182_campaign_auto_approve_policy.sql
-- Build #3: confidence-gated campaign auto-approve engine — policy + ledger.
--
-- Mirrors the proven MEETINGS auto-approve precedent (meeting_auto_approve_*
-- columns on site_config + auto-approve-meetings.mjs). Adds an owner-tunable
-- policy to the site_config singleton and an append-only decision LEDGER so
-- every engine decision (in shadow OR live) is recorded and owner-reviewable.
--
-- SAFETY: approving a campaign flips active=true which fires campaign_notify_
-- trigger (mig 0008) — IRREVERSIBLE legislator-facing notifications. So the
-- engine ships in SHADOW mode (enabled=false, mode='shadow') by default; it
-- only WRITES the ledger until the owner promotes it from the admin panel. A
-- DB-level CHECK guarantees mode='live' can never be set without enabled=true.
--
-- Rollback: drop table campaign_auto_approve_decisions; drop the added
-- site_config columns + constraint.

-- 1. Owner-tunable policy on the site_config singleton (no deploy to change).
alter table public.site_config
  add column if not exists campaign_auto_approve_enabled        boolean not null default false,
  add column if not exists campaign_auto_approve_mode           text    not null default 'shadow',
  add column if not exists campaign_auto_approve_min_confidence numeric not null default 0.85,
  add column if not exists campaign_auto_approve_require_source  boolean not null default true,
  add column if not exists campaign_auto_reject_enabled         boolean not null default false,
  add column if not exists campaign_auto_approve_stale_days      integer not null default 45,
  add column if not exists campaign_auto_approve_max_per_run     integer not null default 10,
  add column if not exists campaign_auto_approve_max_per_day     integer not null default 40,
  add column if not exists campaign_auto_approve_min_age_hours   integer not null default 26;

comment on column public.site_config.campaign_auto_approve_enabled        is 'Master switch for the campaign auto-approve engine. Default false (shadow scaffolding ships inert).';
comment on column public.site_config.campaign_auto_approve_mode           is 'off | shadow (log decisions only, no writes) | live (apply approve+supersede). live requires enabled=true (CHECK).';
comment on column public.site_config.campaign_auto_approve_min_confidence is 'Confidence floor for the RARE bill-linked campaign path only (bills.relevance_confidence). Alert-born rows are gated categorically, not by this number.';
comment on column public.site_config.campaign_auto_approve_require_source is 'Require the linked alert/news_item to have a non-empty source_url before auto-approve.';
comment on column public.site_config.campaign_auto_reject_enabled         is 'Allow the engine to auto-REJECT clearly-junk campaigns. Default false; owner-only to enable (a wrong reject buries a real CTA).';
comment on column public.site_config.campaign_auto_approve_stale_days      is 'Pending auto campaigns older than this with still-empty targets are reject-eligible (when auto-reject on).';
comment on column public.site_config.campaign_auto_approve_max_per_run     is 'Per-run blast cap on auto-approvals (counted after dedup cluster-collapse).';
comment on column public.site_config.campaign_auto_approve_max_per_day     is 'Rolling 24h blast cap on auto-approvals across all hourly runs.';
comment on column public.site_config.campaign_auto_approve_min_age_hours   is 'Min candidate age before approve, so the daily FP/locality janitors settle first (closes the hourly-engine-beats-daily-sweep race).';

-- Bounds so a stray edit can't push a nonsense policy.
alter table public.site_config
  add constraint campaign_auto_approve_mode_chk
    check (campaign_auto_approve_mode in ('off', 'shadow', 'live')),
  add constraint campaign_auto_approve_min_confidence_chk
    check (campaign_auto_approve_min_confidence between 0.5 and 1),
  add constraint campaign_auto_approve_stale_days_chk
    check (campaign_auto_approve_stale_days between 1 and 365),
  add constraint campaign_auto_approve_max_per_run_chk
    check (campaign_auto_approve_max_per_run between 1 and 100),
  add constraint campaign_auto_approve_max_per_day_chk
    check (campaign_auto_approve_max_per_day between 1 and 500),
  add constraint campaign_auto_approve_min_age_hours_chk
    check (campaign_auto_approve_min_age_hours between 0 and 168),
  -- The critical safety invariant: you cannot be in 'live' mode unless the
  -- master switch is on. A stray UPDATE that sets mode='live' alone fails.
  add constraint campaign_auto_approve_live_requires_enabled_chk
    check (campaign_auto_approve_mode <> 'live' or campaign_auto_approve_enabled = true);

-- 2. Append-only decision ledger. Every engine decision (shadow or live) plus
--    every auto-create.ts auto-publish lands here, giving the owner a complete,
--    tamper-proof evidence base to review BEFORE promoting to live.
create table if not exists public.campaign_auto_approve_decisions (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.campaigns(id) on delete cascade,
  decided_at    timestamptz not null default now(),
  mode          text,                       -- shadow | live (mode at decision time)
  decision      text not null check (decision in ('approve', 'reject', 'supersede', 'escalate')),
  score         numeric,                    -- bill-linked confidence when applicable, else null
  signals       jsonb,                      -- the categorical signals behind the call
  review_reason text,                        -- plain-English explanation for the owner
  applied       boolean not null default false  -- true = a real state change happened (live)
);

create index if not exists ix_caa_decisions_decided_at
  on public.campaign_auto_approve_decisions (decided_at desc);
create index if not exists ix_caa_decisions_campaign
  on public.campaign_auto_approve_decisions (campaign_id);

comment on table public.campaign_auto_approve_decisions is
  'Append-only ledger of campaign auto-approve engine decisions (shadow + live) and auto-create auto-publishes. Owner/admin SELECT only; no app-layer write policy (service-role cron bypasses RLS) so it is tamper-proof evidence.';

-- RLS: admins/owner can READ; NO insert/update/delete policy exists, so the
-- only writer is the service-role cron (which bypasses RLS). App users — even
-- admins — cannot mutate the ledger. This makes it append-only by construction.
alter table public.campaign_auto_approve_decisions enable row level security;

drop policy if exists caa_decisions_admin_read on public.campaign_auto_approve_decisions;
create policy caa_decisions_admin_read
  on public.campaign_auto_approve_decisions
  for select
  to authenticated
  using (public.is_admin(auth.uid()));
