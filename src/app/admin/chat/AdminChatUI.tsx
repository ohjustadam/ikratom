"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { askAdminChatbot, type ChatTurn, type ChatSource } from "@/modules/admin/chatbot-actions";

type Turn = {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
  provider?: string;
  error?: boolean;
};

const STARTERS = [
  "Which states have active 7-OH-restriction bills this year?",
  "Summarize the top 3 strongest research findings on natural-leaf kratom safety.",
  "Who are the most-active legislators on kratom legislation right now?",
  "What does the corpus say about the gas-station-heroin framing?",
];

export function AdminChatUI() {
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new turn
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, pending]);

  function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setInput("");
    const userTurn: Turn = { role: "user", content: q };
    const priorContext: ChatTurn[] = history.map((t) => ({ role: t.role, content: t.content }));
    setHistory((h) => [...h, userTurn]);
    startTransition(async () => {
      const result = await askAdminChatbot(q, priorContext);
      if (result.ok) {
        setHistory((h) => [...h, { role: "assistant", content: result.answer, sources: result.sources, provider: result.provider }]);
      } else {
        setHistory((h) => [...h, { role: "assistant", content: result.error, error: true }]);
      }
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send(input);
  }

  function onClear() {
    if (!confirm("Clear this conversation?")) return;
    setHistory([]);
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div
        ref={scrollRef}
        className="max-h-[60vh] min-h-[200px] overflow-y-auto p-4"
      >
        {history.length === 0 && !pending && (
          <div className="text-center">
            <p className="text-sm text-zinc-500">Start a conversation. Try one of these:</p>
            <ul className="mt-3 space-y-2">
              {STARTERS.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => send(s)}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-[12px] text-zinc-300 hover:border-emerald-700/50 hover:text-emerald-200"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {history.map((t, i) => (
          <div key={i} className={`mb-3 ${t.role === "user" ? "ml-8 text-right" : "mr-8"}`}>
            <div
              className={`inline-block max-w-full rounded-md px-3 py-2 text-sm ${
                t.role === "user"
                  ? "bg-emerald-700 text-white"
                  : t.error
                    ? "border border-red-900/40 bg-red-950/30 text-red-200"
                    : "border border-zinc-800 bg-zinc-900 text-zinc-200"
              }`}
            >
              <p className="whitespace-pre-wrap text-left">{t.content}</p>
              {t.role === "assistant" && t.sources && t.sources.length > 0 && (
                <div className="mt-3 border-t border-zinc-800 pt-2 text-left">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">Sources</p>
                  <ul className="mt-1 space-y-1">
                    {t.sources.map((s) => (
                      <li key={s.n} className="text-[11px]">
                        <Link href={s.href} className="text-emerald-400 hover:underline">
                          [src:{s.n}] {s.kind} · {s.title.slice(0, 80)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {t.provider && (
                    <p className="mt-2 text-[10px] text-zinc-600">via {t.provider}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {pending && (
          <div className="mr-8 mb-3">
            <div className="inline-block rounded-md border border-emerald-700/30 bg-zinc-900 px-3 py-2 text-sm text-emerald-200">
              <span className="animate-pulse">thinking…</span>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="flex items-center gap-2 border-t border-zinc-800 p-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about bills, research, legislators, campaigns…"
          maxLength={500}
          disabled={pending}
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-60"
          autoFocus
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-500 disabled:opacity-60"
        >
          Send
        </button>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-500"
          >
            Clear
          </button>
        )}
      </form>
    </div>
  );
}
