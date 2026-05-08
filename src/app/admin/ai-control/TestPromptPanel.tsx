"use client";

import { useState, useTransition } from "react";
import { runTestPrompt } from "@/modules/admin/ai-test-actions";

/**
 * Sandbox for iterating on prompts in /admin/ai-control. Pick a
 * provider (or leave on auto-route), paste a system + user prompt,
 * see the output + latency + token counts. Logged to ai_jobs like
 * any production call so the test costs are visible.
 *
 * Use cases:
 *   - tweaking the bill_summary system prompt before deploying it
 *   - sanity-checking what each provider returns for the same input
 *   - debugging weird outputs by re-running with different temperatures
 *
 * Not exhaustive — for the structured outputs we ship, the actual
 * shape validation lives in the calling code, not here. This is for
 * quick "does the model say what I expect" checks.
 */
export function TestPromptPanel() {
  const [systemPrompt, setSystemPrompt] = useState(
    "You are a helpful assistant.",
  );
  const [userPrompt, setUserPrompt] = useState("");
  const [forceProvider, setForceProvider] = useState<"" | "ollama" | "groq" | "gemini">("");
  const [pending, startTransition] = useTransition();
  type Outcome =
    | {
        ok: true;
        provider: string;
        model: string;
        elapsedMs: number;
        text: string;
        tokens?: { input?: number; output?: number; total?: number };
      }
    | { error: string };
  const [result, setResult] = useState<Outcome | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const r = await runTestPrompt({
        systemPrompt,
        userPrompt,
        forceProvider: forceProvider || undefined,
      });
      setResult(r as Outcome);
    });
  }

  return (
    <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">sandbox</p>
          <h2 className="text-sm font-bold text-zinc-100">Test prompt</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Run an arbitrary prompt against any configured provider. Logged to ai_jobs.
          </p>
        </div>
        <select
          value={forceProvider}
          onChange={(e) => setForceProvider(e.target.value as typeof forceProvider)}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs"
        >
          <option value="">Auto-route</option>
          <option value="ollama">Force ollama</option>
          <option value="groq">Force groq</option>
          <option value="gemini">Force gemini</option>
        </select>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            system
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            placeholder="System prompt — set the role / output format / constraints"
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            user
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            rows={5}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 focus:border-emerald-500 focus:outline-none"
            placeholder="Whatever you want the model to act on"
          />
        </div>

        <button
          onClick={run}
          disabled={pending || !userPrompt.trim()}
          className="rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          {pending ? "Running…" : "Run prompt"}
        </button>
      </div>

      {result && "error" in result && (
        <p className="mt-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 font-mono text-xs text-red-300">
          {result.error}
        </p>
      )}

      {result && "ok" in result && (
        <div className="mt-3 rounded-md border border-emerald-900/40 bg-zinc-950 p-3">
          <div className="mb-2 flex flex-wrap gap-2 text-[10px] font-mono">
            <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
              {result.provider}
            </span>
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">{result.model}</span>
            <span className="text-zinc-500">{result.elapsedMs}ms</span>
            {result.tokens?.input != null && result.tokens?.output != null && (
              <span className="text-zinc-500">
                {result.tokens.input.toLocaleString()}→{result.tokens.output.toLocaleString()} tok
              </span>
            )}
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap text-xs text-zinc-200">{result.text}</pre>
        </div>
      )}
    </section>
  );
}
