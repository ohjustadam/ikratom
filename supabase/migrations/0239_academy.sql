-- ============================================================
-- 0239 — iKratom Academy (P2: course engine)
-- ============================================================
-- The university-style course on kratom & 7-OH (owner ask 2026-07-09;
-- private/ACHIEVEMENTS_AND_ACADEMY_PLAN.md). P2 = schema + content model +
-- server-graded problem sets. The exam + certificate + public checkmark are P3.
--
-- ANTI-CHEESE (core requirement): the answer key never reaches the client.
--   * academy_questions (with correct_index + explanation) has RLS that allows
--     ONLY admins to read it. There is NO public/authenticated SELECT policy.
--   * The public reads questions through academy_questions_public — a view that
--     exposes prompt/choices/points ONLY (no correct_index, no explanation) and
--     only for PUBLISHED lessons. The view is SECURITY DEFINER (default) so it
--     reads the base as owner but surfaces just the safe columns.
--   * Grading is server-side in academy_grade_answer() (SECURITY DEFINER): the
--     client submits an answer index, the function compares against the base
--     table and returns correctness + explanation. The key is never shipped.
--
-- Content status: courses/modules/lessons carry status ('draft'|'published').
-- Public reads see PUBLISHED only; drafts are admin-only — so authored-but-not-
-- yet-expert-reviewed content stays gated until an admin publishes it.
--
-- Points: completing a lesson (first time) awards 'course_lesson' points via the
-- existing achievement_points ledger (idempotent per lesson).
--
-- Rollback: drop the two functions + the view + the 6 tables (bottom-up).

-- ---------- content tables ----------
create table if not exists public.academy_courses (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  summary text,
  status text not null default 'draft' check (status in ('draft','published')),
  content_version int not null default 1,
  ord int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.academy_modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text,
  ord int not null default 0,
  status text not null default 'draft' check (status in ('draft','published')),
  unique (course_id, slug)
);

create table if not exists public.academy_lessons (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.academy_modules(id) on delete cascade,
  slug text not null,
  title text not null,
  body_md text not null default '',
  citations jsonb not null default '[]'::jsonb,
  ord int not null default 0,
  status text not null default 'draft' check (status in ('draft','published')),
  unique (module_id, slug)
);

create table if not exists public.academy_questions (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.academy_lessons(id) on delete cascade,
  prompt text not null,
  choices jsonb not null default '[]'::jsonb,   -- array of strings
  correct_index int not null,                    -- 0-based; NEVER exposed publicly
  explanation text,
  points int not null default 5,
  ord int not null default 0
);
create index if not exists academy_questions_lesson_idx on public.academy_questions(lesson_id);

-- ---------- per-user progress ----------
create table if not exists public.academy_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id uuid not null references public.academy_lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);
create index if not exists academy_progress_user_idx on public.academy_progress(user_id);

create table if not exists public.academy_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.academy_questions(id) on delete cascade,
  answer_index int,
  is_correct boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists academy_attempts_user_idx on public.academy_attempts(user_id);

-- ---------- RLS ----------
alter table public.academy_courses  enable row level security;
alter table public.academy_modules  enable row level security;
alter table public.academy_lessons  enable row level security;
alter table public.academy_questions enable row level security;
alter table public.academy_progress enable row level security;
alter table public.academy_attempts enable row level security;

-- Content: public reads PUBLISHED; admins read/write everything (drafts included).
create policy academy_courses_read on public.academy_courses for select
  using (status = 'published' or public.is_admin(auth.uid()));
create policy academy_courses_admin on public.academy_courses for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy academy_modules_read on public.academy_modules for select
  using (status = 'published' or public.is_admin(auth.uid()));
create policy academy_modules_admin on public.academy_modules for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

create policy academy_lessons_read on public.academy_lessons for select
  using (status = 'published' or public.is_admin(auth.uid()));
create policy academy_lessons_admin on public.academy_lessons for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Questions: ADMIN-ONLY direct read (the answer key). Public goes through the
-- view below. Admins may author.
create policy academy_questions_admin on public.academy_questions for all
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- Progress + attempts: self only.
create policy academy_progress_self on public.academy_progress for select
  using (auth.uid() = user_id);
create policy academy_attempts_self on public.academy_attempts for select
  using (auth.uid() = user_id);
-- (No self insert/update: progress + attempts are written ONLY by the definer
--  RPCs below, so a user can't forge completion or attempt history.)

-- ---------- public-safe question view (no answer key) ----------
create or replace view public.academy_questions_public as
  select q.id, q.lesson_id, q.prompt, q.choices, q.points, q.ord
  from public.academy_questions q
  join public.academy_lessons l on l.id = q.lesson_id
  where l.status = 'published';
grant select on public.academy_questions_public to anon, authenticated;

-- ---------- grading (server-side; key never shipped) ----------
create or replace function public.academy_grade_answer(p_question_id uuid, p_answer_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  q record;
  correct boolean;
begin
  if uid is null then
    return jsonb_build_object('error', 'Sign in to take the course.');
  end if;
  select correct_index, explanation into q from public.academy_questions where id = p_question_id;
  if not found then
    return jsonb_build_object('error', 'Question not found.');
  end if;
  correct := (p_answer_index = q.correct_index);
  insert into public.academy_attempts(user_id, question_id, answer_index, is_correct)
  values (uid, p_question_id, p_answer_index, correct);
  return jsonb_build_object('is_correct', correct, 'correct_index', q.correct_index, 'explanation', q.explanation);
end;
$$;
revoke all on function public.academy_grade_answer(uuid, int) from public;
grant execute on function public.academy_grade_answer(uuid, int) to authenticated;

-- ---------- lesson completion (+ points) ----------
create or replace function public.academy_complete_lesson(p_lesson_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  is_published boolean;
  newly int;
  awarded int;
begin
  if uid is null then
    return jsonb_build_object('error', 'Sign in to track progress.');
  end if;
  select (status = 'published') into is_published from public.academy_lessons where id = p_lesson_id;
  if not coalesce(is_published, false) then
    return jsonb_build_object('error', 'Lesson not available.');
  end if;

  insert into public.academy_progress(user_id, lesson_id)
  values (uid, p_lesson_id) on conflict (user_id, lesson_id) do nothing;
  get diagnostics newly = row_count;

  -- First completion → award course_lesson points (idempotent via the ledger's
  -- own unique(user_id, kind, ref_id)).
  if newly > 0 then
    insert into public.achievement_points(user_id, kind, points, ref_type, ref_id)
    values (uid, 'course_lesson', 5, 'lesson', p_lesson_id::text)
    on conflict (user_id, kind, ref_id) do nothing;
    get diagnostics awarded = row_count;
    if awarded > 0 then
      update public.profiles set points_total = points_total + 5 where id = uid;
    end if;
  end if;

  return jsonb_build_object('completed', true, 'newly', newly > 0);
end;
$$;
revoke all on function public.academy_complete_lesson(uuid) from public;
grant execute on function public.academy_complete_lesson(uuid) to authenticated;
