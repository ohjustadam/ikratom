import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { LessonEditor } from "./LessonEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Edit lesson" };

export default async function AdminLessonEditPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");
  const { id } = await params;

  const sb = await createClient();
  const { data: lesson } = await sb
    .from("academy_lessons")
    .select("id, title, body_md, citations, status")
    .eq("id", id)
    .maybeSingle();
  if (!lesson) notFound();

  // Admin RLS lets us read the base questions table incl. the answer key.
  const { data: questions } = await sb
    .from("academy_questions")
    .select("id, prompt, choices, correct_index, explanation, ord")
    .eq("lesson_id", id)
    .order("ord");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <Link href="/admin/academy" className="text-xs text-zinc-500 hover:text-emerald-400">← Academy admin</Link>
      <LessonEditor
        lesson={{
          id: lesson.id,
          title: lesson.title,
          body_md: lesson.body_md ?? "",
          citations: (lesson.citations as { n?: number; label: string; url: string }[]) ?? [],
          status: lesson.status,
        }}
        questions={(questions ?? []).map((q) => ({
          id: q.id, prompt: q.prompt, choices: (q.choices as string[]) ?? [], correctIndex: q.correct_index, explanation: q.explanation ?? "",
        }))}
      />
    </div>
  );
}
