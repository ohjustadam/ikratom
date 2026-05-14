"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrichLibraryUrl, type LibraryUrlSuggestion } from "@/modules/library/enrich-url-action";
import { createLibraryItem } from "@/modules/library/actions";

const TYPE_OPTIONS = [
  { value: "video", label: "📺 Video" },
  { value: "audio", label: "🎙️ Audio / Podcast" },
  { value: "article", label: "📄 Article" },
  { value: "document", label: "📑 Document" },
  { value: "book", label: "📚 Book" },
];

const RELEVANCE_OPTIONS = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

/**
 * Quick-add form. Two phases:
 *
 *   Phase 1 — URL only. Paste → click Fetch → server hits oEmbed / OG
 *             tags / AI → returns suggestion.
 *
 *   Phase 2 — Review + save. Auto-filled fields shown, all editable,
 *             extra fields available (tags, featured, etc.). Hit save
 *             and the existing createLibraryItem server action takes
 *             over (same one the manual form uses).
 *
 * The fetch step is the leverage — the 12-field form collapses into
 * "paste, glance, save" for the 95% of additions that come from a URL.
 */
export function QuickAddForm({ preselectedType }: { preselectedType: string | null }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [fetching, startFetch] = useTransition();
  const [saving, startSave] = useTransition();
  const [suggestion, setSuggestion] = useState<LibraryUrlSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editable copies of the auto-filled fields
  const [type, setType] = useState(preselectedType ?? "article");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("");
  const [sourceOrg, setSourceOrg] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [embedHtml, setEmbedHtml] = useState("");
  const [publishedAt, setPublishedAt] = useState("");
  const [tags, setTags] = useState("");
  const [relevance, setRelevance] = useState("high");
  const [featured, setFeatured] = useState(false);

  function onFetch() {
    setError(null);
    if (!url.trim()) {
      setError("Paste a URL first.");
      return;
    }
    startFetch(async () => {
      const result = await enrichLibraryUrl(url.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const s = result.suggestion;
      setSuggestion(s);
      setType(s.type);
      setTitle(s.title);
      setDescription(s.description);
      setAuthor(s.author ?? "");
      setSourceOrg(s.source_org ?? "");
      setCoverImage(s.cover_image_url ?? "");
      setEmbedHtml(s.embed_html ?? "");
      setPublishedAt(s.published_at ?? "");
    });
  }

  function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    const fd = new FormData();
    fd.set("type", type);
    fd.set("title", title);
    fd.set("description", description);
    fd.set("url", url);
    fd.set("author", author);
    fd.set("source_org", sourceOrg);
    fd.set("cover_image_url", coverImage);
    fd.set("embed_html", embedHtml);
    fd.set("published_at", publishedAt);
    fd.set("tags", tags);
    fd.set("kratom_relevance", relevance);
    fd.set("active", "on");
    if (featured) fd.set("featured", "on");

    startSave(async () => {
      const result = await createLibraryItem(fd);
      // createLibraryItem redirects on success — we only see a result
      // object on failure.
      if (result && "error" in result) {
        setError(result.error);
      } else {
        router.push("/library");
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* ── Phase 1: URL input ─────────────────────────────────── */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <label className="block text-xs font-medium text-zinc-300">
          Source URL <span className="text-red-400">*</span>
        </label>
        <div className="mt-1 flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=… or https://example.com/article"
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            disabled={fetching || saving}
          />
          <button
            type="button"
            onClick={onFetch}
            disabled={fetching || saving || !url.trim()}
            className="shrink-0 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {fetching ? "Fetching…" : suggestion ? "Re-fetch" : "⚡ Fetch"}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-zinc-500">
          YouTube uses oEmbed. Generic URLs use Open Graph tags. AI fills in description if the source has none.
        </p>
      </section>

      {/* ── Source warnings (from enrich-url-action) ────────────── */}
      {suggestion && suggestion.warnings.length > 0 && (
        <div className="rounded-md border border-amber-700/40 bg-amber-950/15 p-3 text-xs text-amber-300">
          {suggestion.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </div>
      )}

      {/* ── Phase 2: Review + save ──────────────────────────────── */}
      {suggestion && (
        <form onSubmit={onSave} className="space-y-5">
          <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
                Auto-filled · review &amp; edit
              </h2>
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                source: {suggestion.source_type.replace(/_/g, " ")}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Type">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FieldLabel>
              <FieldLabel label="Relevance">
                <select
                  value={relevance}
                  onChange={(e) => setRelevance(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {RELEVANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </FieldLabel>
            </div>

            <FieldLabel label="Title *">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </FieldLabel>

            <FieldLabel label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </FieldLabel>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Author / creator">
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </FieldLabel>
              <FieldLabel label="Source org">
                <input
                  type="text"
                  value={sourceOrg}
                  onChange={(e) => setSourceOrg(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </FieldLabel>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="Published date">
                <input
                  type="date"
                  value={publishedAt}
                  onChange={(e) => setPublishedAt(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </FieldLabel>
              <FieldLabel label="Cover image URL">
                <input
                  type="url"
                  value={coverImage}
                  onChange={(e) => setCoverImage(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </FieldLabel>
            </div>

            {coverImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverImage}
                alt="Cover preview"
                className="mt-2 max-h-40 rounded border border-zinc-800"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            )}

            {embedHtml && (
              <details>
                <summary className="cursor-pointer text-[11px] text-zinc-400 hover:text-emerald-400">
                  Embed HTML (auto-fetched, click to inspect/edit) ▾
                </summary>
                <textarea
                  value={embedHtml}
                  onChange={(e) => setEmbedHtml(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] focus:border-emerald-500 focus:outline-none"
                />
              </details>
            )}

            <FieldLabel label="Tags (comma-separated)">
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="kcpa, beginner, history, medical"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </FieldLabel>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={featured}
                onChange={(e) => setFeatured(e.target.checked)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              ⭐ Feature this item (pinned to top of /library)
            </label>
          </section>

          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Add to library"}
            </button>
            <a href="/library" className="text-sm text-zinc-400 hover:text-emerald-400">
              Cancel
            </a>
            <span className="ml-auto text-[11px] text-zinc-600">
              Need more fields?{" "}
              <a href="/admin/library/new/manual" className="text-emerald-400 hover:underline">
                Use the full manual form
              </a>
            </span>
          </div>
        </form>
      )}

      {/* ── First-render error (before fetch) ────────────────────── */}
      {!suggestion && error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <label className="block text-xs font-medium text-zinc-300">{label}</label>
      {children}
    </div>
  );
}
