-- ============================================================
-- 0070_bill_forum_thread_link
--
-- Track which bills have been auto-posted to the state forum so
-- the auto-post cron is idempotent. Without this, every cron tick
-- could spam the forum with the same bill.
--
-- Also adds forum_threads.system_generated so display logic can
-- show "iKratom Bot" instead of "Member" / blank for null author_id.
-- ============================================================

alter table public.bills
  add column if not exists forum_thread_id uuid references public.forum_threads(id) on delete set null,
  add column if not exists forum_posted_at timestamptz;

create index if not exists ix_bills_forum_thread
  on public.bills (forum_thread_id)
  where forum_thread_id is not null;

alter table public.forum_threads
  add column if not exists system_generated boolean not null default false;

comment on column public.forum_threads.system_generated is
  'Set true for threads created by automation (auto-bill-poster, auto-alerts). UI should attribute these to "iKratom Bot" rather than the null author.';
