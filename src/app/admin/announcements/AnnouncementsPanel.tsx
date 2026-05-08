"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAnnouncement, deleteAnnouncement } from "@/modules/announcements/actions";

type Row = {
  id: string;
  title: string;
  body: string;
  cta_label: string | null;
  cta_href: string | null;
  tone: string;
  pinned: boolean;
  publish_at: string;
  expires_at: string | null;
};

export function AnnouncementsPanel({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initial.length === 0);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const formEl = e.currentTarget;
    startTransition(async () => {
      const r = await createAnnouncement({
        title: String(fd.get("title") ?? ""),
        body: String(fd.get("body") ?? ""),
        ctaLabel: String(fd.get("cta_label") ?? "") || undefined,
        ctaHref: String(fd.get("cta_href") ?? "") || undefined,
        tone: (String(fd.get("tone") ?? "info")) as "info" | "success" | "warn" | "danger",
        pinned: fd.get("pinned") === "on",
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        formEl.reset();
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function onDelete(id: string) {
    if (!confirm("Delete announcement?")) return;
    startTransition(async () => {
      await deleteAnnouncement(id);
      router.refresh();
    });
  }

  return (
    <>
      {initial.length > 0 && (
        <ul className="mb-6 space-y-2">
          {initial.map((a) => {
            const expired = a.expires_at && new Date(a.expires_at) < new Date();
            return (
              <li
                key={a.id}
                className={`rounded-md border p-3 text-sm ${
                  expired ? "border-zinc-900 opacity-50" : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-100">{a.title}</span>
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                    a.tone === "danger" ? "bg-red-950/40 text-red-300" :
                    a.tone === "warn" ? "bg-amber-950/40 text-amber-300" :
                    a.tone === "success" ? "bg-emerald-950/40 text-emerald-300" :
                    "bg-blue-950/40 text-blue-300"
                  }`}>
                    {a.tone}
                  </span>
                  {a.pinned && (
                    <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] text-amber-300">📌 pinned</span>
                  )}
                  {expired && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-500">expired</span>
                  )}
                  <button
                    onClick={() => onDelete(a.id)}
                    disabled={pending}
                    className="ml-auto rounded-md border border-red-900/50 px-2 py-0.5 text-[11px] text-red-300 hover:border-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-1 text-xs text-zinc-400">{a.body}</p>
                {a.cta_href && a.cta_label && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    CTA: <span className="text-emerald-400">{a.cta_label}</span> → <span className="font-mono">{a.cta_href}</span>
                  </p>
                )}
                <p className="mt-1 text-[10px] text-zinc-600">
                  Published {new Date(a.publish_at).toLocaleString()}
                  {a.expires_at && ` · Expires ${new Date(a.expires_at).toLocaleString()}`}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {showForm ? (
        <form onSubmit={onCreate} className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <Field name="title" label="Title" placeholder="e.g. Cockpit customization is live" required />
          <div>
            <label className="block text-xs font-medium text-zinc-300">Body</label>
            <textarea
              name="body"
              rows={4}
              required
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field name="cta_label" label="CTA label (optional)" placeholder="See what's new" />
            <Field name="cta_href" label="CTA link (optional)" placeholder="/dashboard" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Tone</label>
              <select name="tone" className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm">
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warn">Warn</option>
                <option value="danger">Danger</option>
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-xs">
              <input type="checkbox" name="pinned" className="h-4 w-4 rounded border-zinc-700 bg-zinc-950" />
              <span>Pin to top</span>
            </label>
          </div>
          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {pending ? "Posting…" : "Post"}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500"
        >
          + New announcement
        </button>
      )}
    </>
  );
}

function Field({
  name, label, placeholder, required,
}: { name: string; label: string; placeholder?: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-300">{label}</label>
      <input
        name={name}
        type="text"
        placeholder={placeholder}
        required={required}
        className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
    </div>
  );
}
