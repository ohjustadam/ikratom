"use client";

import { useState, useTransition } from "react";
import { savePatchNote, setPatchNoteStatus, type AdminPatchNote } from "@/modules/admin/patch-note-actions";

/**
 * One changelog entry, editable in place.
 *
 * This is the curation step. The cron writes raw generator output; nothing
 * reaches the public page until someone reads it here and presses Publish.
 */
export default function PatchNoteEditor({ note }: { note: AdminPatchNote }) {
  const [title, setTitle] = useState(note.title);
  const [summary, setSummary] = useState(note.summary ?? "");
  const [body, setBody] = useState(note.body_md);
  const [status, setStatus] = useState(note.status);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(status === "draft");
  const [pending, startTransition] = useTransition();

  const published = status === "published";

  function save() {
    startTransition(async () => {
      const r = await savePatchNote({ slug: note.slug, title, summary, bodyMd: body });
      setMsg("error" in r ? r.error : "Saved.");
    });
  }

  function toggle() {
    startTransition(async () => {
      const r = await setPatchNoteStatus({ slug: note.slug, publish: !published });
      if ("error" in r) return setMsg(r.error);
      setStatus(published ? "archived" : "published");
      setMsg(published ? "Pulled from the changelog." : "Published — it is live now.");
    });
  }

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-zinc-500">{note.published_on}</span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
            published
              ? "bg-emerald-500 text-zinc-950"
              : status === "draft"
                ? "bg-amber-500 text-zinc-950"
                : "bg-zinc-700 text-zinc-200"
          }`}
        >
          {status}
        </span>
        <span className="flex-1 truncate text-sm font-semibold">{title}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-zinc-400 hover:text-emerald-400"
        >
          {open ? "Collapse" : "Review"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <input
            id={`title-${note.slug}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="Headline"
          />
          <input
            id={`summary-${note.slug}`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            placeholder="One-line summary"
          />
          <textarea
            id={`body-${note.slug}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 font-mono text-xs"
            placeholder="Markdown body"
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                published
                  ? "bg-zinc-700 hover:bg-zinc-600"
                  : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              }`}
            >
              {published ? "Pull from changelog" : "Publish"}
            </button>
            <a
              href={`/whats-new/${note.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zinc-500 hover:text-emerald-400"
            >
              Preview →
            </a>
            {msg && <span className="text-xs text-zinc-400">{msg}</span>}
          </div>
        </div>
      )}
    </li>
  );
}
