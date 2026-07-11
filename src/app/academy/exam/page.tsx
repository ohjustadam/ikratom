import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ExamRunner } from "./ExamRunner";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Final exam — iKratom Academy",
  description: "Pass the iKratom Academy final exam to earn your certificate and the power-user checkmark.",
};

export default async function ExamPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  // Single published course for now (ikratom-academy). RLS returns published.
  const { data: course } = await sb
    .from("academy_courses")
    .select("id, title, exam_pass_pct, exam_size")
    .eq("status", "published")
    .order("ord")
    .limit(1)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8 text-zinc-100">
      <div className="text-xs text-zinc-500">
        <Link href="/academy" className="hover:text-emerald-400">🎓 Academy</Link> · Final exam
      </div>
      <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Final exam</h1>

      {!course ? (
        <p className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          The exam isn&apos;t open yet — the course is still being finalized. Study the{" "}
          <Link href="/academy" className="text-emerald-400 hover:underline">lessons</Link> in the meantime.
        </p>
      ) : !user ? (
        <p className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 text-sm text-zinc-400">
          <Link href="/login" className="text-emerald-400 hover:underline">Sign in</Link> to take the exam and earn your certificate.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-400">
            {course.exam_size} questions drawn at random · pass at {course.exam_pass_pct}% · earns your
            certificate + the power-user checkmark. Study the lessons first — the questions come from them.
          </p>
          <ExamRunner courseId={course.id} />
        </>
      )}
    </div>
  );
}
