-- ============================================================
-- 0049_user_dashboard_layouts
--
-- Per-user cockpit configuration. Each row is one user's preferences:
-- which widgets are shown, in what order, plus a few cosmetic prefs
-- like accent color. Stored as JSONB so we can grow the widget catalog
-- without schema migrations.
--
-- The `widgets` value is an ordered array of {id, visible} pairs:
--   [{"id":"briefing","visible":true},
--    {"id":"my_reps","visible":true},
--    {"id":"streak","visible":false},
--    ...]
--
-- The position in the array IS the render order. The component reads
-- this, applies it to the default widget set, and renders the result.
-- Unknown widget ids are ignored (forward-compatible).
--
-- onboarded_at: null = first-time user, fire the welcome tour. Set when
-- user finishes (or skips) the tour. Replayable from /account so this
-- isn't a one-shot.
-- ============================================================

create table if not exists public.user_dashboard_layouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  widgets jsonb not null default '[]'::jsonb,
  accent_color text not null default 'emerald'
    check (accent_color in ('emerald','amber','blue','red','zinc')),
  preset text check (preset is null or preset in ('strike','intel','lounge','custom')),
  onboarded_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_dashboard_layouts enable row level security;

-- Users manage their own row only. No admin override needed —
-- this is purely cosmetic preference data, no security gate.
drop policy if exists "dashboard_layouts_self" on public.user_dashboard_layouts;
create policy "dashboard_layouts_self"
  on public.user_dashboard_layouts
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-bump updated_at on UPDATE so the cockpit can show "last
-- customized 3 days ago" if we ever want.
create or replace function public.touch_dashboard_layouts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_dashboard_layouts on public.user_dashboard_layouts;
create trigger trg_touch_dashboard_layouts
  before update on public.user_dashboard_layouts
  for each row execute function public.touch_dashboard_layouts_updated_at();
