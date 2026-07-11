import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PowerUserBadge } from "@/components/PowerUserBadge";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "iKratom Academy — learn kratom & 7-OH, become a credible advocate",
  description: "A free, university-style course on kratom and 7-OH: the science, the law, and how to advocate effectively. Earn points as you learn.",
};

type Lesson = { id: string; slug: string; title: string; ord: number; status: string };
type Module = { id: string; slug: string; title: string; summary: string | null; ord: number; status: string; academy_lessons: Lesson[] };
type Course = { id: string; slug: string; title: string; summary: string | null; status: string; ord: number; academy_modules: Module[] };

export default async function AcademyPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  // RLS returns published content to everyone; drafts only to admins.
  const [{ data: courses }, progressRes, certRes] = await Promise.all([
    sb.from("academy_courses")
      .select("id, slug, title, summary, status, ord, academy_modules(id, slug, title, summary, ord, status, academy_lessons(id, slug, title, ord, status))")
      .order("ord"),
    user
      ? sb.from("academy_progress").select("lesson_id").eq("user_id", user.id)
      : Promise.resolve({ data: [] as { lesson_id: string }[] }),
    user
      ? sb.from("academy_certifications").select("cert_code").eq("user_id", user.id).limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const done = new Set((progressRes.data ?? []).map((p) => p.lesson_id));
  const certCode = (certRes.data as { cert_code: string } | null)?.cert_code ?? null;
  const list = ((courses ?? []) as Course[]).filter((c) => c.academy_modules?.length);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">🎓 iKratom Academy</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Learn it. Own the room.</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-400">
        A free, cited course on kratom &amp; 7-OH — the science, the law, and how to move a legislator.
        Finish lessons to earn points. Facts, not hype; never medical advice.
      </p>

      {user && list.length > 0 && (
        certCode ? (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-4">
            <PowerUserBadge size="md" />
            <span className="text-sm font-semibold text-emerald-200">You&apos;re Academy-certified.</span>
            <Link href={`/academy/certificate/${certCode}`} className="text-sm text-emerald-400 hover:underline">View certificate →</Link>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <span className="text-sm text-zinc-300">Studied the lessons? Pass the final exam to earn your certificate + the power-user checkmark.</span>
            <Link href="/academy/exam" className="shrink-0 rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500">Take the final exam →</Link>
          </div>
        )
      )}

      {list.length === 0 ? (
        <p className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          The course is being prepared — check back shortly.
        </p>
      ) : (
        list.map((course) => (
          <section key={course.id} className="mt-8">
            {course.status !== "published" && (
              <span className="mb-2 inline-block rounded bg-amber-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Draft (admin preview)</span>
            )}
            <div className="space-y-4">
              {[...course.academy_modules].sort((a, b) => a.ord - b.ord).map((m, mi) => {
                const lessons = [...(m.academy_lessons ?? [])].sort((a, b) => a.ord - b.ord);
                const doneCount = lessons.filter((l) => done.has(l.id)).length;
                return (
                  <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="text-base font-bold text-zinc-100">
                        <span className="text-zinc-500">{mi + 1}.</span> {m.title}
                        {m.status !== "published" && <span className="ml-2 text-[10px] uppercase text-amber-400">draft</span>}
                      </h2>
                      {lessons.length > 0 && (
                        <span className="shrink-0 text-[11px] text-zinc-500">{doneCount}/{lessons.length}</span>
                      )}
                    </div>
                    {m.summary && <p className="mt-1 text-xs text-zinc-400">{m.summary}</p>}
                    <ul className="mt-3 space-y-1.5">
                      {lessons.map((l) => (
                        <li key={l.id}>
                          <Link
                            href={`/academy/lesson/${l.id}`}
                            className="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900 hover:text-emerald-300"
                          >
                            <span className={done.has(l.id) ? "text-emerald-400" : "text-zinc-600"}>{done.has(l.id) ? "✓" : "○"}</span>
                            <span>{l.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {!user && list.length > 0 && (
        <p className="mt-6 text-xs text-zinc-500">
          <Link href="/login" className="text-emerald-400 hover:underline">Sign in</Link> to track your progress and earn points.
        </p>
      )}
    </div>
  );
}
