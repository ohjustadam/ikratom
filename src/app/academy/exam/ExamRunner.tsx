"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { startExam, submitExam } from "@/modules/academy/actions";

type Q = { id: string; prompt: string; choices: string[] };
type Phase =
  | { k: "loading" }
  | { k: "blocked"; msg: string; retry?: boolean }
  | { k: "certified" }
  | { k: "ready"; questions: Q[]; passPct: number }
  | { k: "result"; passed: boolean; scorePct: number; passPct: number; certCode: string | null };

/**
 * Runs a single exam sitting. Questions come from academy_start_exam (no answer
 * key); answers are graded by academy_submit_exam server-side. One sitting per
 * mount — a fresh sitting is a fresh page load (which re-draws random questions).
 */
export function ExamRunner({ courseId }: { courseId: string }) {
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [, start] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await startExam({ courseId });
      if (cancelled) return;
      if (r.ok) setPhase({ k: "ready", questions: r.questions, passPct: r.passPct });
      else if (r.alreadyCertified) setPhase({ k: "certified" });
      else if (r.cooldown)
        setPhase({ k: "blocked", msg: `You've used all ${r.cooldown.maxAttempts} attempts for now. Try again in up to ${r.cooldown.windowHours}h — study the lessons meanwhile.` });
      else setPhase({ k: "blocked", msg: r.error ?? "Exam unavailable." });
    })();
    return () => { cancelled = true; };
  }, [courseId]);

  if (phase.k === "loading") return <p className="mt-6 text-sm text-zinc-400">Preparing your exam…</p>;

  if (phase.k === "certified")
    return (
      <div className="mt-6 rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-5 text-sm">
        <p className="font-semibold text-emerald-300">✓ You&apos;re already certified.</p>
        <Link href="/academy" className="mt-2 inline-block text-emerald-400 hover:underline">Back to the course →</Link>
      </div>
    );

  if (phase.k === "blocked")
    return (
      <div className="mt-6 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5 text-sm text-amber-200">
        {phase.msg} <Link href="/academy" className="text-emerald-400 hover:underline">Back to lessons →</Link>
      </div>
    );

  if (phase.k === "result") {
    const { passed, scorePct, passPct, certCode } = phase;
    return (
      <div className={`mt-6 rounded-lg border p-6 ${passed ? "border-emerald-600/60 bg-emerald-950/20" : "border-amber-700/40 bg-amber-950/10"}`}>
        <p className={`text-2xl font-bold ${passed ? "text-emerald-300" : "text-amber-300"}`}>
          {passed ? "🎉 Passed!" : "Not this time"}
        </p>
        <p className="mt-1 text-sm text-zinc-300">You scored <strong>{scorePct}%</strong> (need {passPct}%).</p>
        {passed ? (
          <div className="mt-3 space-y-2 text-sm">
            <p className="text-emerald-200">You&apos;ve earned the <strong>power-user checkmark</strong> ✓ and +100 points.</p>
            {certCode && (
              <Link href={`/academy/certificate/${certCode}`} className="inline-block rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">
                View your certificate →
              </Link>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-zinc-400">
            Review the <Link href="/academy" className="text-emerald-400 hover:underline">lessons</Link> and try again — you get a fresh random set each attempt.
          </p>
        )}
      </div>
    );
  }

  // ready
  const { questions, passPct } = phase;
  const allAnswered = questions.every((q) => picked[q.id] != null);

  function finish() {
    start(async () => {
      const answers = questions.map((q) => ({ question_id: q.id, answer_index: picked[q.id] }));
      const r = await submitExam({ courseId, answers });
      if (r.ok) setPhase({ k: "result", passed: r.passed, scorePct: r.scorePct, passPct: r.passPct, certCode: r.certCode });
      else setPhase({ k: "blocked", msg: r.error });
    });
  }

  return (
    <div className="mt-6 space-y-4">
      {questions.map((q, qi) => (
        <div key={q.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <p className="text-sm font-medium text-zinc-100">{qi + 1}. {q.prompt}</p>
          <ul className="mt-2 space-y-1">
            {q.choices.map((c, ci) => (
              <li key={ci}>
                <button
                  type="button"
                  onClick={() => setPicked((p) => ({ ...p, [q.id]: ci }))}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                    picked[q.id] === ci ? "border-emerald-600/60 bg-emerald-950/10 text-zinc-100" : "border-zinc-800 text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  {c}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <button
        type="button"
        onClick={finish}
        disabled={!allAnswered}
        className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
      >
        Submit exam ({Object.keys(picked).length}/{questions.length} answered) · need {passPct}%
      </button>
    </div>
  );
}
