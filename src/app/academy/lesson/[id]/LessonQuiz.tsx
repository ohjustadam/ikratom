"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { submitAnswer, completeLesson } from "@/modules/academy/actions";

type Q = { id: string; prompt: string; choices: string[]; points: number };
type Result = { isCorrect: boolean; correctIndex: number; explanation: string | null };

/**
 * Interactive lesson problem set. Answers are graded server-side
 * (submitAnswer → academy_grade_answer RPC) — the client never holds the key.
 * Completing the lesson awards points once.
 */
export function LessonQuiz({
  lessonId,
  questions,
  signedIn,
  initiallyComplete,
}: {
  lessonId: string;
  questions: Q[];
  signedIn: boolean;
  initiallyComplete: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [results, setResults] = useState<Record<string, Result>>({});
  const [complete, setComplete] = useState(initiallyComplete);
  const [earned, setEarned] = useState(false);
  const [, start] = useTransition();

  if (!signedIn) {
    return (
      <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <Link href="/login" className="text-emerald-400 hover:underline">Sign in</Link> to take the quiz, track progress, and earn points.
      </div>
    );
  }

  function grade(q: Q) {
    const answerIndex = picked[q.id];
    if (answerIndex == null) return;
    start(async () => {
      const r = await submitAnswer({ questionId: q.id, answerIndex });
      if (r.ok) setResults((prev) => ({ ...prev, [q.id]: { isCorrect: r.isCorrect, correctIndex: r.correctIndex, explanation: r.explanation } }));
    });
  }

  function finish() {
    start(async () => {
      const r = await completeLesson({ lessonId });
      if (r.ok) { setComplete(true); setEarned(!!r.newly); }
    });
  }

  return (
    <div className="mt-8">
      {questions.length > 0 && (
        <>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-emerald-400">Check your understanding</h2>
          <div className="mt-3 space-y-4">
            {questions.map((q, qi) => {
              const res = results[q.id];
              return (
                <div key={q.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                  <p className="text-sm font-medium text-zinc-100">{qi + 1}. {q.prompt}</p>
                  <ul className="mt-2 space-y-1">
                    {q.choices.map((choice, ci) => {
                      const isPicked = picked[q.id] === ci;
                      const tone = res
                        ? ci === res.correctIndex
                          ? "border-emerald-600/60 bg-emerald-950/20 text-emerald-200"
                          : isPicked
                            ? "border-red-700/50 bg-red-950/20 text-red-200"
                            : "border-zinc-800 text-zinc-400"
                        : isPicked
                          ? "border-emerald-600/60 bg-emerald-950/10 text-zinc-100"
                          : "border-zinc-800 text-zinc-300 hover:border-zinc-600";
                      return (
                        <li key={ci}>
                          <button
                            type="button"
                            disabled={!!res}
                            onClick={() => setPicked((p) => ({ ...p, [q.id]: ci }))}
                            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition disabled:cursor-default ${tone}`}
                          >
                            {res && ci === res.correctIndex ? "✓ " : ""}{choice}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {!res ? (
                    <button
                      type="button"
                      onClick={() => grade(q)}
                      disabled={picked[q.id] == null}
                      className="mt-2 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      Check answer
                    </button>
                  ) : (
                    <p className={`mt-2 text-xs ${res.isCorrect ? "text-emerald-300" : "text-amber-300"}`}>
                      {res.isCorrect ? "Correct." : "Not quite."} {res.explanation}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {complete ? (
          <span className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-4 py-2 text-sm font-semibold text-emerald-300">
            ✓ Lesson complete{earned ? " · +5 points" : ""}
          </span>
        ) : (
          <button
            type="button"
            onClick={finish}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500"
          >
            Mark lesson complete
          </button>
        )}
        <Link href="/academy" className="text-sm text-emerald-400 hover:underline">← Back to course</Link>
      </div>
    </div>
  );
}
