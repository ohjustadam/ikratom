"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAdminAction } from "@/lib/audit";
import { getAdminContext } from "./actions";

/**
 * Academy authoring/publish actions (admin only). Content lives in academy_*
 * tables whose RLS is admin-all, so these run on the admin's own client.
 * Publishing is the go-live gate — content is seeded draft and only appears
 * publicly (and the exam only opens) once an admin publishes after review.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE: Record<string, string> = {
  course: "academy_courses",
  module: "academy_modules",
  lesson: "academy_lessons",
};

function revalidate() {
  revalidatePath("/admin/academy");
  revalidatePath("/academy");
}

export async function setAcademyStatus(input: {
  kind: "course" | "module" | "lesson";
  id: string;
  status: "draft" | "published";
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  const table = TABLE[input.kind];
  if (!table || !UUID_RE.test(input.id) || !["draft", "published"].includes(input.status)) {
    return { ok: false, error: "Invalid request." };
  }
  const sb = await createClient();
  const { error } = await sb.from(table).update({ status: input.status }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await recordAdminAction({ action: `academy_${input.kind}_${input.status}`, details: { id: input.id } });
  revalidate();
  return { ok: true };
}

/** Publish (or unpublish) a whole course tree at once — course + all its
 *  modules + lessons. The one-click "it's reviewed, ship it" (or pull it). */
export async function setCourseTreeStatus(input: {
  courseId: string;
  status: "draft" | "published";
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!UUID_RE.test(input.courseId) || !["draft", "published"].includes(input.status)) {
    return { ok: false, error: "Invalid request." };
  }
  const sb = await createClient();
  const { data: mods } = await sb.from("academy_modules").select("id").eq("course_id", input.courseId);
  const moduleIds = (mods ?? []).map((m) => m.id);
  await sb.from("academy_courses").update({ status: input.status }).eq("id", input.courseId);
  if (moduleIds.length) {
    await sb.from("academy_modules").update({ status: input.status }).eq("course_id", input.courseId);
    await sb.from("academy_lessons").update({ status: input.status }).in("module_id", moduleIds);
  }
  await recordAdminAction({ action: `academy_course_tree_${input.status}`, details: { courseId: input.courseId, modules: moduleIds.length } });
  revalidate();
  return { ok: true };
}

export async function updateLesson(input: {
  id: string;
  title: string;
  body_md: string;
  citations: { n?: number; label: string; url: string }[];
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Invalid lesson." };
  const sb = await createClient();
  const { error } = await sb.from("academy_lessons").update({
    title: input.title.slice(0, 200),
    body_md: input.body_md.slice(0, 20000),
    citations: Array.isArray(input.citations) ? input.citations.slice(0, 40) : [],
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await recordAdminAction({ action: "academy_lesson_edit", details: { id: input.id } });
  revalidate();
  return { ok: true };
}

export async function updateQuestion(input: {
  id: string;
  prompt: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getAdminContext();
  if (!ctx.ok) return { ok: false, error: "Admin only." };
  if (!UUID_RE.test(input.id)) return { ok: false, error: "Invalid question." };
  if (!Array.isArray(input.choices) || input.choices.length < 2) return { ok: false, error: "Need at least 2 choices." };
  if (input.correctIndex < 0 || input.correctIndex >= input.choices.length) return { ok: false, error: "Correct index out of range." };
  const sb = await createClient();
  const { error } = await sb.from("academy_questions").update({
    prompt: input.prompt.slice(0, 1000),
    choices: input.choices.map((c) => String(c).slice(0, 400)),
    correct_index: input.correctIndex,
    explanation: input.explanation.slice(0, 2000),
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await recordAdminAction({ action: "academy_question_edit", details: { id: input.id } });
  revalidate();
  return { ok: true };
}
