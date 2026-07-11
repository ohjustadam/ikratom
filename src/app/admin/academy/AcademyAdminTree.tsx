"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { setAcademyStatus, setCourseTreeStatus } from "@/modules/admin/academy-actions";

type Lesson = { id: string; title: string; status: string };
type Module = { id: string; title: string; status: string; lessons: Lesson[] };
type Course = { id: string; title: string; status: string; examSize: number; publishedQuestions: number; modules: Module[] };

export function AcademyAdminTree({ courses }: { courses: Course[] }) {
  return (
    <div className="space-y-6">
      {courses.map((c) => (
        <CourseBlock key={c.id} course={c} />
      ))}
    </div>
  );
}

function CourseBlock({ course }: { course: Course }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const examReady = course.publishedQuestions >= course.examSize;

  function publishTree(status: "draft" | "published") {
    setMsg(null);
    start(async () => {
      const r = await setCourseTreeStatus({ courseId: course.id, status });
      setMsg(r.ok ? `✓ Course ${status}` : `✗ ${r.error}`);
    });
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">{course.title} <StatusPill status={course.status} /></h2>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-zinc-400">{msg}</span>}
          <button onClick={() => publishTree("published")} disabled={pending}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
            Publish entire course
          </button>
          <button onClick={() => publishTree("draft")} disabled={pending}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500 disabled:opacity-40">
            Unpublish all
          </button>
        </div>
      </div>
      <p className={`mt-1 text-xs ${examReady ? "text-emerald-400" : "text-amber-400"}`}>
        {course.publishedQuestions} published question{course.publishedQuestions === 1 ? "" : "s"} ·
        exam needs {course.examSize} → {examReady ? "exam will open" : "exam stays closed until you publish more"}
      </p>

      <div className="mt-3 space-y-3">
        {course.modules.map((m) => (
          <div key={m.id} className="rounded-md border border-zinc-800/70 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-zinc-200">{m.title} <StatusPill status={m.status} /></span>
              <NodeToggle kind="module" id={m.id} status={m.status} />
            </div>
            <ul className="mt-2 space-y-1">
              {m.lessons.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded px-2 py-1 hover:bg-zinc-900/50">
                  <span className="text-sm text-zinc-300">{l.title} <StatusPill status={l.status} /></span>
                  <span className="flex items-center gap-2">
                    <Link href={`/academy/lesson/${l.id}`} target="_blank" className="text-[11px] text-zinc-400 hover:text-emerald-300">preview ↗</Link>
                    <Link href={`/admin/academy/lesson/${l.id}`} className="text-[11px] text-emerald-400 hover:underline">edit</Link>
                    <NodeToggle kind="lesson" id={l.id} status={l.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function NodeToggle({ kind, id, status }: { kind: "module" | "lesson"; id: string; status: string }) {
  const [cur, setCur] = useState(status);
  const [pending, start] = useTransition();
  const next = cur === "published" ? "draft" : "published";
  return (
    <button
      onClick={() => start(async () => {
        const r = await setAcademyStatus({ kind, id, status: next });
        if (r.ok) setCur(next);
      })}
      disabled={pending}
      className="rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-500 disabled:opacity-40"
    >
      {cur === "published" ? "unpublish" : "publish"}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const pub = status === "published";
  return (
    <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${pub ? "bg-emerald-950/50 text-emerald-300" : "bg-amber-950/40 text-amber-300"}`}>
      {pub ? "live" : "draft"}
    </span>
  );
}
