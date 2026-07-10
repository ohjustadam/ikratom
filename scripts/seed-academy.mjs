#!/usr/bin/env node
/**
 * seed-academy.mjs — seed the iKratom Academy course from authored module JSON.
 *
 * Input: a JSON file (--file) shaped like the academy-content-author workflow's
 * return: [{ intendedSlug, ord, module: { slug, title, summary, lessons:[
 *   { slug, title, body_md, citations:[{n,label,url}],
 *     questions:[{prompt, choices:[...], correct_index, explanation}] } ] } }]
 *
 * Idempotent upsert by slug. Seeds everything as status='draft' — an admin
 * publishes after expert review (public.is_admin surfaces published only).
 * Questions (answer key) are inserted via the service-role client (RLS-exempt).
 *
 *   node --env-file=.env.local scripts/seed-academy.mjs --file=academy.json
 *   node --env-file=.env.local scripts/seed-academy.mjs --file=academy.json --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const fileArg = args.find((a) => a.startsWith("--file="));
if (!fileArg) { console.error("Usage: --file=<path.json> [--dry-run]"); process.exit(1); }
const modules = JSON.parse(readFileSync(fileArg.slice("--file=".length), "utf8"));

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const COURSE = { slug: "ikratom-academy", title: "iKratom Academy", summary: "A free, cited course on kratom & 7-OH: the science, the law, and effective advocacy." };

async function upsert(table, match, row) {
  const existing = (await sb.from(table).select("id").match(match).maybeSingle()).data;
  if (existing) {
    if (!DRY) await sb.from(table).update(row).eq("id", existing.id);
    return existing.id;
  }
  if (DRY) return "(dry-run-id)";
  const { data, error } = await sb.from(table).insert(row).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id;
}

const courseId = await upsert("academy_courses", { slug: COURSE.slug },
  { ...COURSE, status: "draft", ord: 0 });
console.log(`course ${COURSE.slug} → ${courseId}${DRY ? " [dry]" : ""}`);

let mCount = 0, lCount = 0, qCount = 0;
for (const entry of modules) {
  const m = entry.module;
  if (!m?.slug || !Array.isArray(m.lessons)) { console.log("  ⚠ skipping malformed module", entry.intendedSlug); continue; }
  const moduleId = await upsert("academy_modules", { course_id: courseId, slug: m.slug },
    { course_id: courseId, slug: m.slug, title: m.title, summary: m.summary ?? null, ord: entry.ord ?? 0, status: "draft" });
  mCount++;
  console.log(`  module ${m.slug} → ${moduleId}`);
  let li = 0;
  for (const l of m.lessons) {
    if (!l?.slug) continue;
    const lessonId = await upsert("academy_lessons", { module_id: moduleId, slug: l.slug },
      { module_id: moduleId, slug: l.slug, title: l.title, body_md: l.body_md ?? "", citations: l.citations ?? [], ord: li++, status: "draft" });
    lCount++;
    // Replace this lesson's questions wholesale (keeps re-seeds clean).
    if (!DRY) await sb.from("academy_questions").delete().eq("lesson_id", lessonId);
    let qi = 0;
    for (const q of (l.questions ?? [])) {
      if (!q?.prompt || !Array.isArray(q.choices) || typeof q.correct_index !== "number") continue;
      if (!DRY) {
        const { error } = await sb.from("academy_questions").insert({
          lesson_id: lessonId, prompt: q.prompt, choices: q.choices,
          correct_index: q.correct_index, explanation: q.explanation ?? null, points: 5, ord: qi,
        });
        if (error) throw new Error(`question: ${error.message}`);
      }
      qi++; qCount++;
    }
  }
}
console.log(`\nDone${DRY ? " [dry-run]" : ""}: ${mCount} modules, ${lCount} lessons, ${qCount} questions. All status=draft — publish after review.`);
process.exit(0);
