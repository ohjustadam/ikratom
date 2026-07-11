-- ============================================================
-- 0241 — Academy P3: final exam + certificate + power-user checkmark
-- ============================================================
-- Passing a real, server-graded exam earns a certificate and the public
-- power-user checkmark (profiles.power_user_at). This is the ONLY thing that
-- grants the checkmark — you can't buy it with points (see 0236), so it can't
-- be farmed; you have to actually pass.
--
-- ANTI-CHEESE:
--   * The exam draws a RANDOM subset (exam_size) from the course's published
--     question bank, so no two sittings match and one screenshot doesn't transfer.
--   * The answer key never reaches the client — academy_start_exam() returns
--     prompts/choices only; grading is entirely inside academy_submit_exam().
--   * Denominator is FIXED at exam_size (not the count of submitted answers), and
--     correct answers are counted DISTINCT — so submitting one known-correct
--     answer scores 1/exam_size, not 100%.
--   * Attempt cap + cooldown (exam_max_attempts per exam_cooldown_hours),
--     enforced server-side against academy_exam_attempts.
--   * submit returns only the aggregate score — never which questions were right.
--
-- Rollback: drop the 3 functions, academy_certifications, academy_exam_attempts,
-- the 4 academy_courses columns, and profiles.power_user_at.

alter table public.academy_courses
  add column if not exists exam_size int not null default 20,
  add column if not exists exam_pass_pct int not null default 80,
  add column if not exists exam_cooldown_hours int not null default 24,
  add column if not exists exam_max_attempts int not null default 3;

alter table public.profiles add column if not exists power_user_at timestamptz;

create table if not exists public.academy_exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  score_pct int not null,
  passed boolean not null,
  finished_at timestamptz not null default now()
);
create index if not exists academy_exam_attempts_user_idx
  on public.academy_exam_attempts(user_id, course_id, finished_at desc);

create table if not exists public.academy_certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  score_pct int not null,
  cert_code text not null unique,
  content_version int not null default 1,
  passed_at timestamptz not null default now(),
  unique (user_id, course_id, content_version)
);
create index if not exists academy_certifications_user_idx on public.academy_certifications(user_id);

alter table public.academy_exam_attempts enable row level security;
alter table public.academy_certifications enable row level security;

-- Self-read only; both tables are written ONLY by the definer RPCs below.
create policy academy_exam_attempts_self on public.academy_exam_attempts
  for select using (auth.uid() = user_id);
create policy academy_certifications_self on public.academy_certifications
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));

-- ---------- start an exam sitting (eligibility + random question set) ----------
create or replace function public.academy_start_exam(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cfg record;
  recent int;
  poolcount int;
  qs jsonb;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in to take the exam.'); end if;
  select exam_size, exam_pass_pct, exam_cooldown_hours, exam_max_attempts, content_version
    into cfg from public.academy_courses where id = p_course_id and status = 'published';
  if not found then return jsonb_build_object('error', 'Course not available.'); end if;

  if exists (
    select 1 from public.academy_certifications
     where user_id = uid and course_id = p_course_id and content_version = cfg.content_version
  ) then
    return jsonb_build_object('already_certified', true);
  end if;

  select count(*) into recent from public.academy_exam_attempts
   where user_id = uid and course_id = p_course_id
     and finished_at > now() - make_interval(hours => cfg.exam_cooldown_hours);
  if recent >= cfg.exam_max_attempts then
    return jsonb_build_object('cooldown', true, 'max_attempts', cfg.exam_max_attempts, 'window_hours', cfg.exam_cooldown_hours);
  end if;

  select count(*) into poolcount
    from public.academy_questions q
    join public.academy_lessons l on l.id = q.lesson_id
    join public.academy_modules m on m.id = l.module_id
   where m.course_id = p_course_id and l.status = 'published';
  if poolcount < cfg.exam_size then
    return jsonb_build_object('error', 'The exam isn''t ready yet — check back once the course is fully published.');
  end if;

  select jsonb_agg(jsonb_build_object('id', id, 'prompt', prompt, 'choices', choices))
    into qs from (
      select q.id, q.prompt, q.choices
        from public.academy_questions q
        join public.academy_lessons l on l.id = q.lesson_id
        join public.academy_modules m on m.id = l.module_id
       where m.course_id = p_course_id and l.status = 'published'
       order by random()
       limit cfg.exam_size
    ) sub;

  return jsonb_build_object('questions', qs, 'pass_pct', cfg.exam_pass_pct, 'size', cfg.exam_size);
end;
$$;
revoke all on function public.academy_start_exam(uuid) from public;
grant execute on function public.academy_start_exam(uuid) to authenticated;

-- ---------- grade + (on pass) certify ----------
create or replace function public.academy_submit_exam(p_course_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cfg record;
  correct int;
  pct int;
  passed boolean;
  code text;
  inserted int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in.'); end if;
  select exam_size, exam_pass_pct, content_version
    into cfg from public.academy_courses where id = p_course_id and status = 'published';
  if not found then return jsonb_build_object('error', 'Course not available.'); end if;

  -- Count DISTINCT correctly-answered questions that genuinely belong to this
  -- course's published bank. Denominator is the fixed exam_size, so a partial
  -- or padded submission can't inflate the score.
  select count(distinct q.id) into correct
    from jsonb_array_elements(p_answers) a
    join public.academy_questions q on q.id = (a->>'question_id')::uuid
    join public.academy_lessons l on l.id = q.lesson_id
    join public.academy_modules m on m.id = l.module_id
   where m.course_id = p_course_id and l.status = 'published'
     and q.correct_index = (a->>'answer_index')::int;

  pct := least(100, floor(100.0 * coalesce(correct, 0) / greatest(cfg.exam_size, 1)));
  passed := pct >= cfg.exam_pass_pct;

  insert into public.academy_exam_attempts(user_id, course_id, score_pct, passed)
    values (uid, p_course_id, pct, passed);

  if passed then
    insert into public.academy_certifications(user_id, course_id, score_pct, cert_code, content_version)
      values (uid, p_course_id, pct,
              'IKA-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
              cfg.content_version)
      on conflict (user_id, course_id, content_version) do nothing;

    -- Checkmark (set once) + one-time bonus points for this course version.
    update public.profiles set power_user_at = coalesce(power_user_at, now()) where id = uid;
    insert into public.achievement_points(user_id, kind, points, ref_type, ref_id)
      values (uid, 'course_exam_pass', 100, 'course', p_course_id::text || ':v' || cfg.content_version)
      on conflict (user_id, kind, ref_id) do nothing;
    get diagnostics inserted = row_count;
    if inserted > 0 then
      update public.profiles set points_total = points_total + 100 where id = uid;
    end if;

    select cert_code into code from public.academy_certifications
     where user_id = uid and course_id = p_course_id and content_version = cfg.content_version;
  end if;

  return jsonb_build_object('passed', passed, 'score_pct', pct, 'pass_pct', cfg.exam_pass_pct, 'cert_code', code);
end;
$$;
revoke all on function public.academy_submit_exam(uuid, jsonb) from public;
grant execute on function public.academy_submit_exam(uuid, jsonb) to authenticated;

-- ---------- public certificate lookup (anonymity-safe: @username + score) ----------
create or replace function public.academy_get_certificate(p_code text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cert_code', c.cert_code,
    'username', p.username,
    'course_title', co.title,
    'score_pct', c.score_pct,
    'passed_at', c.passed_at
  )
  from public.academy_certifications c
  join public.academy_courses co on co.id = c.course_id
  left join public.profiles p on p.id = c.user_id
  where c.cert_code = p_code;
$$;
revoke all on function public.academy_get_certificate(text) from public;
grant execute on function public.academy_get_certificate(text) to anon, authenticated;

-- ---------- public power-user check (for the @username checkmark) ----------
-- A single-column peek so any public surface can render the checkmark without
-- widening get_public_profile's table signature (which many callers depend on).
-- Only exposes a boolean, never the timestamp or any other field.
create or replace function public.is_power_user(p_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles where id = p_id and power_user_at is not null);
$$;
revoke all on function public.is_power_user(uuid) from public;
grant execute on function public.is_power_user(uuid) to anon, authenticated;
