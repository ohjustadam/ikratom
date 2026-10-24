"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoalitionThread } from "@/modules/coalitions/discussion-actions";

/**
 * "Start a discussion" for a coalition's private board. The welcome checklist
 * opens it pre-filled: a member's hello, or an organizer's pinned welcome post.
 */
export function NewThreadForm({ slug, prefill }: {
  slug: string;
  prefill?: { title: string; body: string; pin?: boolean } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!prefill);
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [body, setBody] = useState(prefill?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
      >
        + Start a discussion
      </button>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCoalitionThread(slug, title, body, { pin: !!prefill?.pin });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/coalitions/${slug}/t/${res.id}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={140}
        placeholder="Topic, e.g. Hearing on HB 123 next Tuesday"
        aria-label="Discussion title"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={5000}
        rows={4}
        placeholder="What do you want the group to know or do?"
        aria-label="Discussion message"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
      />
      {error && <p className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          {pending ? "Posting…" : prefill?.pin ? "Post and pin" : "Post"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
      </div>
    </form>
  );
}
