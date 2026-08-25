"use client";

import { useState, useTransition } from "react";
import { createLibraryItem, updateLibraryItem } from "../actions";
import type { LibraryItemType } from "../types";
import { TYPE_LABELS } from "../types";

import Link from "next/link";
const TYPES: LibraryItemType[] = ["video", "audio", "book", "article", "document"];

type Initial = {
  id?: string;
  type?: string;
  title?: string;
  description?: string | null;
  url?: string | null;
  embed_html?: string | null;
  cover_image_url?: string | null;
  full_text?: string | null;
  summary?: string | null;
  transcript?: string | null;
  author?: string | null;
  source_org?: string | null;
  duration_seconds?: number | null;
  published_at?: string | null;
  tags?: string[];
  kratom_relevance?: string;
  featured?: boolean;
  active?: boolean;
};

export function LibraryItemForm({ initial }: { initial?: Initial }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<string>(initial?.type ?? "article");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = initial?.id
        ? await updateLibraryItem(initial.id, fd)
        : await createLibraryItem(fd);
      if (result && "error" in result) setError(result.error);
    });
  }

  const isMedia = type === "video" || type === "audio";
  const isLongForm = type === "book" || type === "article" || type === "document";

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Section title="Basics">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="type" label="Type *" value={type} onChange={setType}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </Select>
          <Field name="title" label="Title *" defaultValue={initial?.title} required />
        </div>
        <Textarea name="description" label="Short description" defaultValue={initial?.description ?? ""} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="author" label="Author / creator" defaultValue={initial?.author ?? ""} />
          <Field name="source_org" label="Source org" defaultValue={initial?.source_org ?? ""} placeholder="AKA, iKratom, etc." />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="published_at" label="Published date" type="date" defaultValue={initial?.published_at ?? ""} />
          <Field name="duration_seconds" label="Duration (sec)" type="number" defaultValue={initial?.duration_seconds?.toString() ?? ""} />
          <Select name="kratom_relevance" label="Relevance" defaultValue={initial?.kratom_relevance ?? "high"}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>
        <Field
          name="tags"
          label="Tags (comma-separated)"
          defaultValue={initial?.tags?.join(", ") ?? ""}
          placeholder="kcpa, beginner, history, medical"
        />
      </Section>

      {isMedia && (
        <Section title="Media">
          <Field name="url" label="Source URL (YouTube, podcast, etc.)" defaultValue={initial?.url ?? ""} />
          <Textarea
            name="embed_html"
            label="Embed HTML (paste iframe from the source)"
            defaultValue={initial?.embed_html ?? ""}
            rows={3}
            mono
          />
          <Field name="cover_image_url" label="Cover image URL" defaultValue={initial?.cover_image_url ?? ""} />
          <Textarea
            name="transcript"
            label="Transcript (markdown OK — auto-show on detail page)"
            defaultValue={initial?.transcript ?? ""}
            rows={6}
          />
        </Section>
      )}

      {isLongForm && (
        <Section title="Long-form content">
          <Field name="url" label="Source URL (if external)" defaultValue={initial?.url ?? ""} />
          <Field name="cover_image_url" label="Cover image URL" defaultValue={initial?.cover_image_url ?? ""} />
          <Textarea
            name="summary"
            label="Summary (markdown OK — short, ~200 words)"
            defaultValue={initial?.summary ?? ""}
            rows={4}
          />
          <Textarea
            name="full_text"
            label="Full text (markdown — books, long articles)"
            defaultValue={initial?.full_text ?? ""}
            rows={10}
          />
        </Section>
      )}

      <Section title="Status">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950" />
            Active (visible on /library)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="featured" defaultChecked={initial?.featured ?? false} className="h-4 w-4 rounded border-zinc-700 bg-zinc-950" />
            Featured (pinned to top, ★ badge)
          </label>
        </div>
      </Section>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : initial?.id ? "Save changes" : "Add to library"}
        </button>
        <Link href="/library" className="text-sm text-zinc-400 hover:text-emerald-400">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  name, label, type = "text", required, defaultValue, placeholder,
}: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}

function Textarea({
  name, label, defaultValue, rows, mono,
}: { name: string; label: string; defaultValue?: string; rows?: number; mono?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows ?? 4}
        className={`mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}

function Select({
  name, label, value, defaultValue, onChange, children,
}: { name: string; label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400">{label}</label>
      <select
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      >
        {children}
      </select>
    </div>
  );
}
