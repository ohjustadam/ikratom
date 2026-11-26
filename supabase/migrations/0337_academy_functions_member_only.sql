-- 0337: the four academy functions are for signed-in members only.
--
-- Their migrations ran `revoke all ... from public; grant execute ... to
-- authenticated`. That leaves EXECUTE with anon: Supabase's default
-- privileges grant it to anon by name, not through public. Each function
-- already answers a signed-out caller with a "sign in" error, and the site
-- never calls them signed out (the quiz and the exam show a sign-in prompt
-- instead), so no one sees a change. tests/migration-anon-execute.test.ts
-- now fails any later migration that repeats the pattern.
--
-- Rollback: grant execute on function <each function below> to anon;

revoke execute on function public.academy_grade_answer(uuid, int) from anon;
revoke execute on function public.academy_start_exam(uuid) from anon;
revoke execute on function public.academy_submit_exam(uuid, jsonb) from anon;
revoke execute on function public.academy_complete_lesson(uuid) from anon;
