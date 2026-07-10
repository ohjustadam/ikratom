import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Markdown } from "@/components/Markdown";
import { LessonQuiz } from "./LessonQuiz";

export const dynamic = "force-dynamic";

type Citation = { n?: number; label: string; url: string };

export default async function LessonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: lesson } = await sb
    .from("academy_lessons")
    .select("id, title, body_md, citations, status, academy_modules(title, academy_courses(title))")
    .eq("id", id)
    .maybeSingle();
  if (!lesson) notFound();

  const [{ data: questions }, progressRes] = await Promise.all([
    sb.from("academy_questions_public").select("id, prompt, choices, points, ord").eq("lesson_id", id).order("ord"),
    user
      ? sb.from("academy_progress").select("lesson_id").eq("user_id", user.id).eq("lesson_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const mod = Array.isArray(lesson.academy_modules) ? lesson.academy_modules[0] : lesson.academy_modules;
  const course = mod && (Array.isArray(mod.academy_courses) ? mod.academy_courses[0] : mod.academy_courses);
  const citations = (lesson.citations as Citation[] | null) ?? [];
  const qs = (questions ?? []) as { id: string; prompt: string; choices: string[]; points: number }[];

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <div className="text-xs text-zinc-500">
        <Link href="/academy" className="hover:text-emerald-400">🎓 Academy</Link>
        {course && <> · {course.title}</>}{mod && <> · {mod.title}</>}
      </div>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">{lesson.title}</h1>
      {lesson.status !== "published" && (
        <span className="mt-2 inline-block rounded bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
          Draft — pending review
        </span>
      )}

      <article className="mt-5">
        <Markdown>{lesson.body_md}</Markdown>
      </article>

      {citations.length > 0 && (
        <section className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Sources</h2>
          <ol className="mt-2 space-y-1 text-xs text-zinc-400">
            {citations.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-zinc-600">{c.n ?? i + 1}.</span>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline break-words">{c.label}</a>
              </li>
            ))}
          </ol>
        </section>
      )}

      <LessonQuiz
        lessonId={id}
        questions={qs}
        signedIn={!!user}
        initiallyComplete={!!progressRes.data}
      />
    </div>
  );
}
