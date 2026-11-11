"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { replyToFeedback } from "@/modules/feedback/reply-actions";

const MAX = 4000;

/** Reply box under a feedback report. One click sends; the thread refreshes. */
export function FeedbackReplyForm({ id, resolveByDefault }: { id: string; resolveByDefault: boolean }) {
  const [body, setBody] = useState("");
  const [resolve, setResolve] = useState(resolveByDefault);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function send() {
    setMsg(null);
    start(async () => {
      const r = await replyToFeedback({ id, body, resolve });
      if ("error" in r) {
        setMsg({ ok: false, text: r.error });
        return;
      }
      setMsg({
        ok: r.delivered,
        text: r.delivered
          ? `Sent. ${r.label}`
          : `Saved to the thread, but not delivered${r.detail ? `: ${r.detail}` : ""}. Nothing was marked resolved.`,
      });
      if (r.delivered) setBody("");
      router.refresh();
    });
  }

  return (
    <div className="mt-2">
      <label htmlFor={`reply-${id}`} className="sr-only">
        Reply
      </label>
      <textarea
        id={`reply-${id}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={MAX}
        rows={3}
        placeholder="Write a reply…"
        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-600 focus:outline-none"
      />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={pending || !body.trim()}
          className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send reply"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />
          Mark resolved
        </label>
        <span className="ml-auto text-[10px] text-zinc-600">
          {body.length}/{MAX}
        </span>
      </div>
      {msg && <p className={`mt-1 text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
    </div>
  );
}
