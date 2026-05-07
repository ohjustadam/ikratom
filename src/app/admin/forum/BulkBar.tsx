"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { bulkApproveContent, bulkRemoveContent } from "@/modules/forum/actions";

/**
 * Floating bulk-action bar for the forum moderation queue. Tracks selected
 * post + thread IDs (set by individual checkboxes on the queue page) and
 * applies an approve/remove action to all of them at once.
 *
 * The bar reads selected IDs from URL hash so that selecting + paginating
 * stays straightforward without lifting state into a context. (On this v1,
 * pagination is fine via page reload.)
 */

export function BulkBar() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function getSelected(): { posts: string[]; threads: string[] } {
    const posts: string[] = [];
    const threads: string[] = [];
    if (typeof document === "undefined") return { posts, threads };
    const checked = document.querySelectorAll<HTMLInputElement>('input[data-mod-select]:checked');
    checked.forEach((el) => {
      const kind = el.getAttribute("data-mod-kind");
      const id = el.getAttribute("data-mod-id");
      if (!id) return;
      if (kind === "post") posts.push(id);
      else if (kind === "thread") threads.push(id);
    });
    return { posts, threads };
  }

  function approveAll() {
    const sel = getSelected();
    const total = sel.posts.length + sel.threads.length;
    if (total === 0) { setError("Select at least one item."); return; }
    if (!confirm(`Approve ${total} item${total === 1 ? "" : "s"}?`)) return;
    setError(null);
    startTransition(async () => {
      const r = await bulkApproveContent(sel);
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function removeAll() {
    const sel = getSelected();
    const total = sel.posts.length + sel.threads.length;
    if (total === 0) { setError("Select at least one item."); return; }
    const reason = prompt(`Reason for removing ${total} item${total === 1 ? "" : "s"} (optional):`) ?? undefined;
    if (reason === null) return;
    setError(null);
    startTransition(async () => {
      const r = await bulkRemoveContent({ ...sel, reason: reason || undefined });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function selectAll() {
    document.querySelectorAll<HTMLInputElement>('input[data-mod-select]')
      .forEach((el) => { el.checked = true; });
  }
  function clearAll() {
    document.querySelectorAll<HTMLInputElement>('input[data-mod-select]:checked')
      .forEach((el) => { el.checked = false; });
  }

  return (
    <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/40 bg-zinc-950/95 p-3 backdrop-blur">
      <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
        Bulk
      </span>
      <button onClick={selectAll} className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-emerald-500">
        Select all
      </button>
      <button onClick={clearAll} className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500">
        Clear
      </button>
      <span className="ml-auto flex gap-2">
        <button
          onClick={approveAll}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "…" : "Approve selected"}
        </button>
        <button
          onClick={removeAll}
          disabled={pending}
          className="rounded-md border border-red-900/50 px-3 py-1.5 text-xs text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Remove selected
        </button>
      </span>
      {error && <span className="w-full text-xs text-red-300">{error}</span>}
    </div>
  );
}
