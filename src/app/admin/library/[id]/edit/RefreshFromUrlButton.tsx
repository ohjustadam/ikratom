"use client";

import { useState, useTransition } from "react";
import { enrichLibraryUrl, type LibraryUrlSuggestion } from "@/modules/library/enrich-url-action";

/**
 * Refresh-from-URL button for the library edit page. Renders above
 * the existing LibraryItemForm. On click:
 *   1. Calls enrichLibraryUrl with the item's current URL
 *   2. Shows a side-by-side "current vs. fetched" preview
 *   3. Admin picks which fields to overwrite (or applies all)
 *
 * Field overwrites happen via DOM — we grab the form by name and set
 * input/textarea values, then dispatch a 'change' event so React's
 * onChange handlers (if any) fire. This avoids having to rewrite the
 * uncontrolled LibraryItemForm.
 */
export function RefreshFromUrlButton({ currentUrl }: { currentUrl: string | null }) {
  const [pending, startTransition] = useTransition();
  const [suggestion, setSuggestion] = useState<LibraryUrlSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!currentUrl) {
    return (
      <p className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-500">
        💡 To enable URL-based refresh, set a Source URL on this item first.
      </p>
    );
  }

  function onFetch() {
    setError(null);
    setSuggestion(null);
    startTransition(async () => {
      const r = await enrichLibraryUrl(currentUrl!);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSuggestion(r.suggestion);
    });
  }

  function setField(name: string, value: string) {
    const el = document.querySelector(
      `form [name="${name}"]`,
    ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el) return;
    // Use the native value setter so React's controlled-component
    // tracker sees the change.
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyAll() {
    if (!suggestion) return;
    if (suggestion.title) setField("title", suggestion.title);
    if (suggestion.description) setField("description", suggestion.description);
    if (suggestion.author) setField("author", suggestion.author);
    if (suggestion.source_org) setField("source_org", suggestion.source_org);
    if (suggestion.cover_image_url) setField("cover_image_url", suggestion.cover_image_url);
    if (suggestion.embed_html) setField("embed_html", suggestion.embed_html);
    if (suggestion.published_at) setField("published_at", suggestion.published_at);
  }

  return (
    <section className="mb-4 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            🔄 Refresh metadata from URL
          </h3>
          <p className="mt-1 text-[11px] text-zinc-400 break-all">
            Re-fetches title / description / cover from <code className="text-zinc-300">{currentUrl}</code>.
            YouTube uses oEmbed; other URLs use Open Graph tags. AI fills description if source has none.
          </p>
        </div>
        <button
          type="button"
          onClick={onFetch}
          disabled={pending}
          className="shrink-0 rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500 disabled:opacity-50"
        >
          {pending ? "Fetching…" : suggestion ? "Re-fetch" : "🔄 Fetch"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded border border-red-900/40 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">
          {error}
        </p>
      )}

      {suggestion && (
        <div className="mt-3 space-y-2 text-[11px]">
          <div className="rounded border border-zinc-800 bg-zinc-950 p-2">
            <p className="text-zinc-500">Fetched preview:</p>
            <ul className="mt-1 space-y-0.5">
              {suggestion.title && <li><span className="text-zinc-500">Title:</span> <span className="text-zinc-200">{suggestion.title}</span></li>}
              {suggestion.description && <li><span className="text-zinc-500">Description:</span> <span className="text-zinc-300">{suggestion.description.slice(0, 200)}{suggestion.description.length > 200 ? "…" : ""}</span></li>}
              {suggestion.author && <li><span className="text-zinc-500">Author:</span> <span className="text-zinc-200">{suggestion.author}</span></li>}
              {suggestion.source_org && <li><span className="text-zinc-500">Source org:</span> <span className="text-zinc-200">{suggestion.source_org}</span></li>}
              {suggestion.published_at && <li><span className="text-zinc-500">Published:</span> <span className="text-zinc-200">{suggestion.published_at}</span></li>}
              {suggestion.cover_image_url && <li><span className="text-zinc-500">Cover:</span> <span className="text-zinc-300 break-all">{suggestion.cover_image_url}</span></li>}
            </ul>
          </div>
          {suggestion.warnings.length > 0 && (
            <div className="rounded border border-amber-700/40 bg-amber-950/15 p-2 text-amber-300">
              {suggestion.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyAll}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              Apply to form (overwrites)
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
