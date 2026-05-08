-- ============================================================
-- 0053_badges_and_announcements
--
-- Two related Cockpit Tier 4 features in one migration:
--
-- A) user_badges — earnable patches/achievements. Each badge_id is a
--    string identifier defined in code (src/modules/badges/catalog.ts).
--    Server-side award logic checks conditions and inserts a row;
--    nothing checks-then-inserts twice because PRIMARY KEY is
--    (user_id, badge_id) so reawarding is a no-op.
--
-- B) announcements + announcement_dismissals — admin-curated platform
--    announcements that show up as a "what's new" widget on the
--    dashboard. Admin posts via /admin/announcements; users dismiss
--    individually (per-user state in a separate table).
-- ============================================================

-- ── A) Badges ──────────────────────────────────────────────
create table if not exists public.user_badges (
  user_id uuid not null references public.profiles(id) on delete cascade,
  badge_id text not null check (length(badge_id) between 1 and 60),
  earned_at timestamptz not null default now(),
  metadata jsonb,                                -- e.g. { count: 50 } for tiered badges
  primary key (user_id, badge_id)
);

create index if not exists idx_user_badges_user
  on public.user_badges (user_id, earned_at desc);

alter table public.user_badges enable row level security;

-- Public read: badges show on the user's profile, anyone can see them.
drop policy if exists "user_badges_public_read" on public.user_badges;
create policy "user_badges_public_read"
  on public.user_badges for select to authenticated
  using (true);

-- Inserts via service-role only (cron / triggers / server actions
-- using the service-role client). No user-side INSERT policy.

-- ── B) Announcements ──────────────────────────────────────
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  -- short title (e.g. "Discord integration is live")
  title text not null check (length(title) between 1 and 120),
  -- body in plain markdown (we render with a tiny safe markdown helper)
  body text not null check (length(body) between 1 and 2000),
  -- optional CTA
  cta_label text check (cta_label is null or length(cta_label) <= 60),
  cta_href text check (cta_href is null or length(cta_href) <= 500),
  -- accent: cosmetic
  tone text not null check (tone in ('info','success','warn','danger')) default 'info',
  -- when null = active. Setting publish_at = future means scheduled.
  publish_at timestamptz not null default now(),
  -- expires_at null = never. otherwise hidden from /dashboard after.
  expires_at timestamptz,
  -- optional pin: shown above all unpinned, regardless of publish_at
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_announcements_publish_at
  on public.announcements (publish_at desc);

alter table public.announcements enable row level security;

-- Anyone can read currently-visible announcements
drop policy if exists "announcements_public_read" on public.announcements;
create policy "announcements_public_read"
  on public.announcements for select to authenticated
  using (
    publish_at <= now()
    and (expires_at is null or expires_at > now())
  );

-- Admins can do everything
drop policy if exists "announcements_admin_all" on public.announcements;
create policy "announcements_admin_all"
  on public.announcements for all to authenticated
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Per-user dismissal table: when user clicks "dismiss" we insert here
-- and the widget filters out dismissed announcements.
create table if not exists public.announcement_dismissals (
  user_id uuid not null references public.profiles(id) on delete cascade,
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, announcement_id)
);

alter table public.announcement_dismissals enable row level security;

drop policy if exists "dismissals_self" on public.announcement_dismissals;
create policy "dismissals_self"
  on public.announcement_dismissals for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Helper: list visible-to-user announcements (un-dismissed, in window).
-- SECURITY DEFINER because the widget needs to LEFT JOIN against
-- announcement_dismissals which has a self-only RLS — we'd otherwise
-- need a complex permitted view. Returns minimal fields; safe to expose.
create or replace function public.visible_announcements(p_user_id uuid)
returns table (
  id uuid,
  title text,
  body text,
  cta_label text,
  cta_href text,
  tone text,
  pinned boolean,
  publish_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select a.id, a.title, a.body, a.cta_label, a.cta_href, a.tone, a.pinned, a.publish_at
    from public.announcements a
   where a.publish_at <= now()
     and (a.expires_at is null or a.expires_at > now())
     and not exists (
       select 1 from public.announcement_dismissals d
        where d.user_id = p_user_id
          and d.announcement_id = a.id
     )
   order by a.pinned desc, a.publish_at desc
   limit 5;
$$;

revoke all on function public.visible_announcements(uuid) from public;
grant execute on function public.visible_announcements(uuid) to authenticated;
