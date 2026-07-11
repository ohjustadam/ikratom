"use client";

import { useState, useTransition } from "react";
import { updateLesson, updateQuestion } from "@/modules/admin/academy-actions";

type Citation = { n?: number; label: string; url: string };
type Q = { id: string; prompt: string; choices: string[]; correctIndex: number; explanation: string };

export function LessonEditor({
  lesson,
  questions,
}: {
  lesson: { id: string; title: string; body_md: string; citations: Citation[]; status: string };
  questions: Q[];
}) {
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body_md);
  const [citationsText, setCitationsText] = useState(JSON.stringify(lesson.citations, null, 2));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function saveLesson() {
    setMsg(null);
    let citations: Citation[];
    try {
      citations = JSON.parse(citationsText);
      if (!Array.isArray(citations)) throw new Error();
    } catch {
      setMsg("✗ Citations must be a JSON array like [{\"n\":1,\"label\":\"…\",\"url\":\"https://…\"}]");
      return;
    }
    start(async () => {
      const r = await updateLesson({ id: lesson.id, title, body_md: body, citations });
      setMsg(r.ok ? "✓ Lesson saved" : `✗ ${r.error}`);
    });
  }

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">Edit lesson</h1>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${lesson.status === "published" ? "bg-emerald-950/50 text-emerald-300" : "bg-amber-950/40 text-amber-300"}`}>
          {lesson.status === "published" ? "live" : "draft"}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Review the science before publishing. Publish toggles live on the <a href="/admin/academy" className="text-emerald-400 hover:underline">Academy admin</a> tree.</p>

      <label className="mt-4 block text-xs font-medium text-zinc-400">Title</label>
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none" />

      <label className="mt-3 block text-xs font-medium text-zinc-400">Body (markdown, inline [n] citations)</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={18}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs leading-relaxed focus:border-emerald-500 focus:outline-none" />

      <label className="mt-3 block text-xs font-medium text-zinc-400">Citations (JSON)</label>
      <textarea value={citationsText} onChange={(e) => setCitationsText(e.target.value)} rows={6}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] focus:border-emerald-500 focus:outline-none" />

      <div className="mt-3 flex items-center gap-3">
        <button onClick={saveLesson} disabled={pending}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">
          Save lesson
        </button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>

      <h2 className="mt-8 text-sm font-bold text-emerald-300">Questions ({questions.length})</h2>
      <div className="mt-2 space-y-3">
        {questions.map((q, i) => <QuestionEditor key={q.id} n={i + 1} q={q} />)}
        {questions.length === 0 && <p className="text-xs text-zinc-500">No questions on this lesson.</p>}
      </div>
    </div>
  );
}

function QuestionEditor({ n, q }: { n: number; q: Q }) {
  const [prompt, setPrompt] = useState(q.prompt);
  const [choices, setChoices] = useState<string[]>(q.choices);
  const [correct, setCorrect] = useState(q.correctIndex);
  const [explanation, setExplanation] = useState(q.explanation);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const r = await updateQuestion({ id: q.id, prompt, choices, correctIndex: correct, explanation });
      setMsg(r.ok ? "✓ Saved" : `✗ ${r.error}`);
    });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Q{n} prompt</label>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm focus:border-emerald-500 focus:outline-none" />
      <div className="mt-2 space-y-1">
        {choices.map((c, ci) => (
          <div key={ci} className="flex items-center gap-2">
            <input type="radio" name={`correct-${q.id}`} checked={correct === ci} onChange={() => setCorrect(ci)} title="Mark correct" className="h-3.5 w-3.5" />
            <input value={c} onChange={(e) => setChoices((prev) => prev.map((x, xi) => xi === ci ? e.target.value : x))}
              className={`w-full rounded border px-2 py-1 text-xs focus:outline-none ${correct === ci ? "border-emerald-600/60 bg-emerald-950/10" : "border-zinc-800 bg-zinc-950"}`} />
          </div>
        ))}
      </div>
      <label className="mt-2 block text-[10px] uppercase tracking-wider text-zinc-500">Explanation (shown after answering)</label>
      <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2}
        className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none" />
      <div className="mt-2 flex items-center gap-2">
        <button onClick={save} disabled={pending} className="rounded border border-emerald-700/40 bg-emerald-950/20 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500 disabled:opacity-40">Save Q{n}</button>
        {msg && <span className="text-xs text-zinc-400">{msg}</span>}
      </div>
    </div>
  );
}
