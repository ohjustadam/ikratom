import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { AcademyAdminTree } from "./AcademyAdminTree";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Academy" };

export default async function AdminAcademyPage() {
  const ctx = await getAdminContext({ require: "edit_academy" });
  if (!ctx.ok) redirect("/dashboard");

  const sb = await createClient();
  // Admin RLS returns all statuses (drafts included).
  const { data: courses } = await sb
    .from("academy_courses")
    .select("id, slug, title, status, exam_size, exam_pass_pct, academy_modules(id, title, status, ord, academy_lessons(id, title, status, ord))")
    .order("ord");

  // Count published questions per course (the exam needs >= exam_size to open).
  const list = courses ?? [];
  const pubQ: Record<string, number> = {};
  for (const c of list) {
    const { count } = await sb
      .from("academy_questions")
      .select("id, academy_lessons!inner(module_id, status, academy_modules!inner(course_id))", { count: "exact", head: true })
      .eq("academy_lessons.status", "published")
      .eq("academy_lessons.academy_modules.course_id", c.id);
    pubQ[c.id] = count ?? 0;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8 text-zinc-100">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Academy</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Review + publish the course. Content is <strong>draft</strong> until you publish it — the public
          sees nothing and the final exam won&apos;t open until then. Review the science first
          (preview any lesson), edit if needed, then publish. The exam needs ≥ the exam size in
          published questions.
        </p>
      </header>

      {list.length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">No courses yet.</p>
      ) : (
        <AcademyAdminTree
          courses={list.map((c) => ({
            id: c.id, title: c.title, status: c.status, examSize: c.exam_size, publishedQuestions: pubQ[c.id] ?? 0,
            modules: [...(c.academy_modules ?? [])].sort((a, b) => a.ord - b.ord).map((m) => ({
              id: m.id, title: m.title, status: m.status,
              lessons: [...(m.academy_lessons ?? [])].sort((a, b) => a.ord - b.ord).map((l) => ({ id: l.id, title: l.title, status: l.status })),
            })),
          }))}
        />
      )}
    </div>
  );
}
