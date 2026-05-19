"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveContent, deleteContent } from "@/modules/admin/content-actions";

/**
 * Mobile-first content editor.
 *
 * One textarea, big tap targets, clear save/delete buttons. The
 * preview pane stays simple (raw text) — full markdown preview
 * would require importing the renderer, which adds bundle weight
 * on a page where it's not necessary. The user can verify by
 * opening the actual /page in another tab.
 */
export function ContentEditor({
  contentKey,
  initialContent,
  initialFormat,
  initialLabel,
  hasOverride,
}: {
  contentKey: string;
  initialContent: string;
  initialFormat: "markdown" | "plain";
  initialLabel: string | null;
  hasOverride: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [format, setFormat] = useState<"markdown" | "plain">(initialFormat);
  const [label, setLabel] = useState(initialLabel ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);
    startTransition(async () => {
      const res = await saveContent({
        key: contentKey,
        content_md: content,
        format,
        label: label || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSavedAt(new Date());
      router.refresh();
    });
  }

  function removeOverride() {
    if (!confirm("Delete this override? The page will revert to its code-defined fallback. The history is preserved.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteContent(contentKey);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/admin/content");
    });
  }

  const charCount = content.length;
  const charCap = 50000;

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
          Format
        </label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["markdown", "plain"] as const).map((f) => (
            <label
              key={f}
              className={`cursor-pointer rounded-md border px-3 py-3 text-center text-sm transition ${
                format === f
                  ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                  : "border-zinc-800 hover:border-zinc-600"
              }`}
            >
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                onChange={() => setFormat(f)}
                className="hidden"
              />
              {f}
              <span className="ml-2 text-[10px] text-zinc-500">
                {f === "markdown" ? "(rich text)" : "(literal)"}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="label-input" className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
          Label <span className="text-zinc-600">(optional)</span>
        </label>
        <input
          id="label-input"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={200}
          placeholder="Short description for the list view"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="content-input" className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
          Content
        </label>
        <textarea
          id="content-input"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={14}
          placeholder={format === "markdown" ? "Markdown supported: **bold**, *italic*, [link](url), bullet lists, headings…" : "Plain text — renders literally with no formatting."}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3 text-base text-zinc-100 placeholder-zinc-600 focus:border-emerald-500 focus:outline-none"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
        />
        <p className="mt-1 text-[10px] text-zinc-500">
          {charCount.toLocaleString()} / {charCap.toLocaleString()} characters
          {charCount > charCap * 0.9 && (
            <span className="ml-2 text-amber-400">⚠ approaching cap</span>
          )}
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-700/40 bg-red-950/20 p-3 text-[11px] text-red-200">
          {error}
        </p>
      )}
      {savedAt && (
        <p className="rounded border border-emerald-700/40 bg-emerald-950/20 p-3 text-[11px] text-emerald-200">
          ✓ Saved at {savedAt.toLocaleTimeString()}. Live within ~1 minute.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || charCount > charCap}
          className="min-h-[48px] flex-1 rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : hasOverride ? "Save override" : "Create override"}
        </button>
        {hasOverride && (
          <button
            type="button"
            onClick={removeOverride}
            disabled={pending}
            className="min-h-[48px] rounded-md border border-red-700/40 bg-red-950/20 px-4 py-3 text-sm text-red-200 hover:bg-red-950/40 disabled:opacity-50"
          >
            🗑 Remove override
          </button>
        )}
      </div>
    </form>
  );
}
