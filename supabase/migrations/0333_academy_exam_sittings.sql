-- ============================================================
-- 0333: the Academy exam grades only the sitting it issued
-- ============================================================
-- Re-checked 2026-11-25 (plan item B6m). Three holes let anyone pass the exam
-- and earn the power-user checkmark without knowing the material:
--
--   1. academy_submit_exam() never checked the attempt cap. Only
--      academy_start_exam() did, so submit could be called without limit.
--   2. Submit graded ANY question from the course bank, not the 20 this
--      sitting drew. With the key, 16 known answers passed every time.
--   3. The key was easy to collect: academy_grade_answer() (the lesson quick
--      checks) returns correct_index, and the exam reuses the same 53
--      questions in the same choice order. Unlimited submits were a second
--      oracle (one answer at a time, read the score).
--
-- The fix:
--   * academy_start_exam() records a SITTING: the drawn questions plus a
--     shuffled choice order for each. A reload within 2 hours hands back the
--     same sitting, so reloading can't fish for easier questions. The cap
--     counts sittings ISSUED, so an abandoned one still uses an attempt.
--   * academy_submit_exam() (same signature, so the site needs no change)
--     claims the open sitting exactly once and grades only the questions it
--     issued. An answer is the position the member saw, mapped back through
--     that sitting's shuffle, so a harvested correct_index no longer scores.
--   * academy_grade_answer() only grades published lessons, and stops at 300
--     tries a day: a quick check is for learning, and every try is a row.
--
-- What this does NOT fix: the exam still draws from the quick-check bank, so
-- someone who matches choice TEXT against a harvested key can still pass. The
-- real fix is an exam-only question set, written in the science review that
-- gates the Academy launch (OWNER_TODO B2).
--
-- The Academy is a draft with 0 published lessons, 0 attempts and 0
-- certificates, so no member is affected.
--
-- Rollback: re-run the three function bodies from 0239 and 0241, then
--   drop table public.academy_exam_sittings;

create table if not exists public.academy_exam_sittings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.academy_courses(id) on delete cascade,
  question_ids uuid[] not null,
  -- { "<question id>": [stored choice index shown at position 0, at 1, ...] }
  perms jsonb not null,
  started_at timestamptz not null default now(),
  submitted_at timestamptz
);
create index if not exists academy_exam_sittings_user_idx
  on public.academy_exam_sittings(user_id, course_id, started_at desc);

-- Only the SECURITY DEFINER functions below read or write it. RLS on with no
-- policy, and no grants: a member can't see the shuffle or forge a sitting.
alter table public.academy_exam_sittings enable row level security;
revoke all on table public.academy_exam_sittings from anon, authenticated;

-- ---------- quick checks: published lessons only, 300 tries a day ----------
create or replace function public.academy_grade_answer(p_question_id uuid, p_answer_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  q record;
  tries int;
  correct boolean;
begin
  if uid is null then
    return jsonb_build_object('error', 'Sign in to take the course.');
  end if;
  select qq.correct_index, qq.explanation into q
    from public.academy_questions qq
    join public.academy_lessons l on l.id = qq.lesson_id
   where qq.id = p_question_id and l.status = 'published';
  if not found then
    return jsonb_build_object('error', 'Question not found.');
  end if;
  select count(*) into tries from public.academy_attempts
   where user_id = uid and attempted_at > now() - interval '24 hours';
  if tries >= 300 then
    return jsonb_build_object('error', 'That''s a lot of answers for one day. Come back tomorrow.');
  end if;
  correct := (p_answer_index = q.correct_index);
  insert into public.academy_attempts(user_id, question_id, answer_index, is_correct)
  values (uid, p_question_id, p_answer_index, correct);
  return jsonb_build_object('is_correct', correct, 'correct_index', q.correct_index, 'explanation', q.explanation);
end;
$$;
revoke all on function public.academy_grade_answer(uuid, int) from public;
grant execute on function public.academy_grade_answer(uuid, int) to authenticated;

-- ---------- start (or resume) a sitting ----------
create or replace function public.academy_start_exam(p_course_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cfg record;
  s record;
  issued int;
  poolcount int;
  ids uuid[];
  shuffles jsonb;
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

  -- An open sitting comes back unchanged, so a reload never re-draws.
  select id, question_ids, perms into s
    from public.academy_exam_sittings
   where user_id = uid and course_id = p_course_id and submitted_at is null
     and started_at > now() - interval '2 hours'
   order by started_at desc
   limit 1;

  if not found then
    select count(*) into issued from public.academy_exam_sittings
     where user_id = uid and course_id = p_course_id
       and started_at > now() - make_interval(hours => cfg.exam_cooldown_hours);
    if issued >= cfg.exam_max_attempts then
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

    with drawn as materialized (
      select q.id, jsonb_array_length(q.choices) as n, random() as r
        from public.academy_questions q
        join public.academy_lessons l on l.id = q.lesson_id
        join public.academy_modules m on m.id = l.module_id
       where m.course_id = p_course_id and l.status = 'published'
       order by random()
       limit cfg.exam_size
    ), shuffled as materialized (
      select d.id, d.r,
             (select jsonb_agg(g.i order by random())
                from generate_series(0, d.n - 1) as g(i)) as perm
        from drawn d
    )
    select array_agg(id order by r), jsonb_object_agg(id::text, perm)
      into ids, shuffles
      from shuffled;

    insert into public.academy_exam_sittings(user_id, course_id, question_ids, perms)
      values (uid, p_course_id, ids, shuffles)
      returning id, question_ids, perms into s;
  end if;

  -- Each question's choices in this sitting's shuffled order.
  select jsonb_agg(
           jsonb_build_object(
             'id', q.id,
             'prompt', q.prompt,
             'choices', (select jsonb_agg(q.choices -> (p.v::int) order by p.ord)
                           from jsonb_array_elements_text(s.perms -> q.id::text) with ordinality as p(v, ord))
           ) order by t.ord)
    into qs
    from unnest(s.question_ids) with ordinality as t(qid, ord)
    join public.academy_questions q on q.id = t.qid;

  return jsonb_build_object('questions', qs, 'pass_pct', cfg.exam_pass_pct, 'size', cfg.exam_size);
end;
$$;
revoke all on function public.academy_start_exam(uuid) from public;
grant execute on function public.academy_start_exam(uuid) to authenticated;

-- ---------- grade the sitting (once) and, on a pass, certify ----------
create or replace function public.academy_submit_exam(p_course_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  cfg record;
  s record;
  correct int;
  pct int;
  passed boolean;
  code text;
  inserted int;
begin
  if uid is null then return jsonb_build_object('error', 'Sign in.'); end if;
  if jsonb_typeof(p_answers) is distinct from 'array' then
    return jsonb_build_object('error', 'Invalid submission.');
  end if;
  select exam_size, exam_pass_pct, content_version
    into cfg from public.academy_courses where id = p_course_id and status = 'published';
  if not found then return jsonb_build_object('error', 'Course not available.'); end if;

  -- Claim the open sitting exactly once. No sitting, or a second submit,
  -- grades nothing.
  update public.academy_exam_sittings
     set submitted_at = now()
   where id = (
           select id from public.academy_exam_sittings
            where user_id = uid and course_id = p_course_id and submitted_at is null
              and started_at > now() - interval '2 hours'
            order by started_at desc
            limit 1
         )
     and submitted_at is null
  returning question_ids, perms into s;
  if not found then
    return jsonb_build_object('error', 'This exam sitting has ended. Start the exam again.');
  end if;

  -- Only questions this sitting issued count. The answer is the position the
  -- member saw; the sitting's shuffle maps it back to the stored choice.
  -- Denominator stays the fixed exam_size, and DISTINCT stops a repeated
  -- answer from counting twice.
  select count(distinct q.id) into correct
    from jsonb_array_elements(p_answers) a
    join public.academy_questions q
      on q.id::text = a->>'question_id'
   where q.id = any(s.question_ids)
     and (a->>'answer_index') ~ '^[0-9]{1,2}$'
     and (s.perms -> q.id::text ->> ((a->>'answer_index')::int))::int = q.correct_index;

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
