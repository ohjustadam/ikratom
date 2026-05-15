"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autofillResearchPaperAbstract } from "@/modules/research/autofill-actions";

/**
 * Admin-only button that triggers free AI auto-fill of a paper's
 * abstract. Mounted on /research/[id] when the viewer is admin AND
 * the paper has no existing abstract.
 *
 * The server action handles auth re-check, AI provider routing, and
 * write. Client-side just shows pending state + result feedback.
 */
export function AdminAutofillButton({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  function onClick() {
    setResult(null);
    startTransition(async () => {
      const r = await autofillResearchPaperAbstract(paperId);
      if (r.ok) {
        setResult({ ok: true, msg: `Filled ${r.chars} chars via ${r.provider}. Refreshing…` });
        setTimeout(() => router.refresh(), 600);
      } else {
        setResult({ ok: false, msg: r.error });
      }
    });
  }

  return (
    <div className="rounded-md border border-emerald-700/40 bg-emerald-950/10 p-4">
      <p className="text-sm font-semibold text-emerald-200">No abstract on file.</p>
      <p className="mt-1 text-[11px] text-zinc-400">
        Try the free AI router (Groq / Gemini Flash / Ollama) to extract the abstract
        from the source URL. The original-content guarantee still applies: AI-summarized
        abstracts are prefixed <code className="rounded bg-zinc-900 px-1">[AI summary, no abstract on source page]</code> so readers know.
      </p>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
      >
        {pending ? "Fetching + summarizing…" : "🤖 Auto-fill abstract (free)"}
      </button>
      {result && (
        <p className={`mt-2 text-[11px] ${result.ok ? "text-emerald-300" : "text-red-300"}`}>
          {result.ok ? "✓ " : "✗ "}{result.msg}
        </p>
      )}
    </div>
  );
}
