"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * iKratom Academy — server actions (P2).
 *
 * Grading + completion run through SECURITY DEFINER RPCs (migration 0239) so
 * the answer key never reaches the client and progress/attempts can't be
 * forged (no self-insert RLS on those tables).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitAnswer(input: {
  questionId: string;
  answerIndex: number;
}): Promise<
  | { ok: true; isCorrect: boolean; correctIndex: number; explanation: string | null }
  | { ok: false; error: string }
> {
  if (!UUID_RE.test(input.questionId) || !Number.isInteger(input.answerIndex)) {
    return { ok: false, error: "Invalid submission." };
  }
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("academy_grade_answer", {
      p_question_id: input.questionId,
      p_answer_index: input.answerIndex,
    });
    if (error) return { ok: false, error: "Couldn't grade that — try again." };
    const r = (data ?? {}) as { error?: string; is_correct?: boolean; correct_index?: number; explanation?: string | null };
    if (r.error) return { ok: false, error: r.error };
    return {
      ok: true,
      isCorrect: !!r.is_correct,
      correctIndex: r.correct_index ?? -1,
      explanation: r.explanation ?? null,
    };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

type ExamQuestion = { id: string; prompt: string; choices: string[] };

export async function startExam(input: {
  courseId: string;
}): Promise<
  | { ok: true; questions: ExamQuestion[]; passPct: number; size: number }
  | { ok: false; alreadyCertified?: boolean; cooldown?: { maxAttempts: number; windowHours: number }; error?: string }
> {
  if (!UUID_RE.test(input.courseId)) return { ok: false, error: "Invalid course." };
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("academy_start_exam", { p_course_id: input.courseId });
    if (error) return { ok: false, error: "Couldn't start the exam — try again." };
    const r = (data ?? {}) as {
      error?: string; already_certified?: boolean;
      cooldown?: boolean; max_attempts?: number; window_hours?: number;
      questions?: ExamQuestion[]; pass_pct?: number; size?: number;
    };
    if (r.already_certified) return { ok: false, alreadyCertified: true };
    if (r.cooldown) return { ok: false, cooldown: { maxAttempts: r.max_attempts ?? 3, windowHours: r.window_hours ?? 24 } };
    if (r.error || !r.questions) return { ok: false, error: r.error ?? "Exam unavailable." };
    return { ok: true, questions: r.questions, passPct: r.pass_pct ?? 80, size: r.size ?? r.questions.length };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function submitExam(input: {
  courseId: string;
  answers: { question_id: string; answer_index: number }[];
}): Promise<
  | { ok: true; passed: boolean; scorePct: number; passPct: number; certCode: string | null }
  | { ok: false; error: string }
> {
  if (!UUID_RE.test(input.courseId) || !Array.isArray(input.answers)) return { ok: false, error: "Invalid submission." };
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("academy_submit_exam", { p_course_id: input.courseId, p_answers: input.answers });
    if (error) return { ok: false, error: "Couldn't grade the exam — try again." };
    const r = (data ?? {}) as { error?: string; passed?: boolean; score_pct?: number; pass_pct?: number; cert_code?: string | null };
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, passed: !!r.passed, scorePct: r.score_pct ?? 0, passPct: r.pass_pct ?? 80, certCode: r.cert_code ?? null };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export async function completeLesson(input: {
  lessonId: string;
}): Promise<{ ok: boolean; newly?: boolean; error?: string }> {
  if (!UUID_RE.test(input.lessonId)) return { ok: false, error: "Invalid lesson." };
  try {
    const sb = await createClient();
    const { data, error } = await sb.rpc("academy_complete_lesson", { p_lesson_id: input.lessonId });
    if (error) return { ok: false, error: "Couldn't save progress — try again." };
    const r = (data ?? {}) as { error?: string; completed?: boolean; newly?: boolean };
    if (r.error) return { ok: false, error: r.error };
    return { ok: true, newly: !!r.newly };
  } catch {
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
