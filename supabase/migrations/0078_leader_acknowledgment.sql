-- ============================================================
-- 0078_leader_acknowledgment
--
-- Required-acknowledgment gate at the end of the leader tour.
-- Until a newly-promoted leader clicks "I acknowledge these rules"
-- at the end of the multi-page walkthrough, this column stays null
-- and the layout shows a sticky banner reminding them to finish.
--
-- Why: leaders have moderation power (campaign authoring, forum
-- moderation, local-rep additions) that affects other users. We
-- want a paper-trail check that they actually saw the rules before
-- exercising those powers.
-- ============================================================

alter table public.profiles
  add column if not exists leader_acknowledged_at timestamptz;

-- Index so the layout's "do you owe the tour?" check is cheap
create index if not exists ix_profiles_leader_unacknowledged
  on public.profiles (id)
  where is_advocate_leader = true
    and leader_acknowledged_at is null;

comment on column public.profiles.leader_acknowledged_at is
  'Set when the user completes the leader tour and clicks the required "I acknowledge these rules" checkbox. Null = leader still owes the tour; layout shows a banner.';
