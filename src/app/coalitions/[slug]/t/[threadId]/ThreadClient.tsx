"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeCoalitionPost, replyCoalitionThread } from "@/modules/coalitions/discussion-actions";
import { pinThread } from "@/modules/coalitions/home-actions";

/** Reply box under a coalition discussion. */
export function ReplyForm({ slug, threadId }: { slug: string; threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await replyCoalitionThread(slug, threadId, body);
      if (!res.ok) { setError(res.error); return; }
      setBody("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        rows={3}
        placeholder="Write a reply…"
        aria-label="Reply"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={pending || !body.trim()}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
      >
        {pending ? "Posting…" : "Reply"}
      </button>
    </form>
  );
}

/** "Remove": shown to the author and the group's owner/admins (RLS enforces it). */
export function RemoveButton({ slug, kind, id, redirectTo }: { slug: string; kind: "thread" | "post"; id: string; redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="mt-2 inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(kind === "thread" ? "Remove this whole discussion?" : "Remove this reply?")) return;
          startTransition(async () => {
            const res = await removeCoalitionPost(slug, kind, id);
            if (!res.ok) { setError(res.error ?? "Couldn't remove it."); return; }
            if (redirectTo) router.push(redirectTo);
            else router.refresh();
          });
        }}
        className="text-[11px] text-zinc-500 underline decoration-dotted hover:text-red-300"
      >
        Remove
      </button>
      {error && <span className="text-[11px] text-red-300">{error}</span>}
    </span>
  );
}

/** Organizers pin one discussion (e.g. the welcome post) to the top of the board. */
export function PinButton({ slug, threadId, pinned }: { slug: string; threadId: string; pinned: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span className="ml-3 inline-flex items-center gap-2">
      <button type="button" disabled={pending} className="text-[11px] text-amber-400/80 hover:text-amber-300"
        onClick={() => startTransition(async () => {
          setError(null);
          const res = await pinThread(slug, threadId, !pinned);
          if (!res.ok) { setError(res.error ?? "Couldn't change that."); return; }
          router.refresh();
        })}>
        {pending ? "…" : pinned ? "📌 Unpin" : "📌 Pin to top"}
      </button>
      {error && <span className="text-[11px] text-amber-300">{error}</span>}
    </span>
  );
}
