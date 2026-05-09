"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createExternalCommunity,
  updateExternalCommunity,
  archiveExternalCommunity,
  unarchiveExternalCommunity,
  deleteExternalCommunity,
  type ExternalCommunity,
} from "@/modules/external-communities/actions";
import { CATEGORY_LABELS, CATEGORIES, type ExtCategory } from "@/modules/external-communities/labels";

export function ExternalCommunitiesPanel({ initial }: { initial: ExternalCommunity[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(initial.length === 0);

  function onCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const formEl = e.currentTarget;
    startTransition(async () => {
      const r = await createExternalCommunity({
        category: String(fd.get("category") ?? "other") as ExtCategory,
        name: String(fd.get("name") ?? "").trim(),
        href: String(fd.get("href") ?? "").trim(),
        description: String(fd.get("description") ?? "").trim() || undefined,
        sort_order: Number(fd.get("sort_order") ?? 100) || 100,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        formEl.reset();
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function onArchive(c: ExternalCommunity) {
    if (c.is_active && !confirm(`Archive "${c.name}"? Hides it from /communities. Reversible.`)) return;
    setError(null);
    startTransition(async () => {
      const r = c.is_active
        ? await archiveExternalCommunity({ id: c.id })
        : await unarchiveExternalCommunity({ id: c.id });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  function onDelete(c: ExternalCommunity) {
    setError(null);
    const typed = prompt(
      `Permanently delete "${c.name}"?\n\nThis is irreversible. Type the name "${c.name}" to confirm.`
    );
    if (typed !== c.name) {
      if (typed !== null) setError(`Confirmation didn't match. Cancelled.`);
      return;
    }
    startTransition(async () => {
      const r = await deleteExternalCommunity({ id: c.id, confirmName: c.name });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  return (
    <>
      {!showForm && (
        <button
          onClick={() => { setShowForm(true); setError(null); }}
          className="mb-4 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          + New community link
        </button>
      )}

      {showForm && (
        <form
          onSubmit={onCreate}
          className="mb-6 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">New community link</h2>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs text-zinc-400">Category</span>
            <select
              name="category"
              defaultValue="facebook"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </label>
          <Field label="Name" name="name" placeholder="r/kratom" required />
          <Field label="URL" name="href" type="url" placeholder="https://reddit.com/r/kratom" required />
          <Field label="Description" name="description" textarea placeholder="One-line pitch — what makes this community worth listing." />
          <Field label="Sort order" name="sort_order" type="number" defaultValue="100" hint="Lower numbers appear first within their category." />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Add to /communities"}
          </button>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {initial.length === 0 ? (
        <p className="text-sm text-zinc-500">No external communities yet. Add one above.</p>
      ) : (
        <ul className="space-y-2">
          {initial.map((c) => (
            <li
              key={c.id}
              id={`row-${c.id}`}
              className={`scroll-mt-20 rounded-md border p-3 ${
                c.is_active ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-900 bg-zinc-950/20 opacity-60"
              }`}
            >
              {editing === c.id ? (
                <EditForm
                  community={c}
                  pending={pending}
                  onSave={(patch) =>
                    startTransition(async () => {
                      const r = await updateExternalCommunity({ id: c.id, ...patch });
                      if ("error" in r) setError(r.error ?? "Failed");
                      else { setEditing(null); router.refresh(); }
                    })
                  }
                  onCancel={() => { setEditing(null); setError(null); }}
                />
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                    {c.category}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-100">{c.name}</span>
                      {!c.is_active && (
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          archived
                        </span>
                      )}
                      <span className="text-[11px] text-zinc-600">sort: {c.sort_order}</span>
                    </div>
                    {c.description && (
                      <p className="mt-1 text-xs text-zinc-400">{c.description}</p>
                    )}
                    <a
                      href={c.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block truncate font-mono text-[10px] text-emerald-400 hover:underline"
                    >
                      {c.href}
                    </a>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => { setEditing(c.id); setError(null); }}
                      className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onArchive(c)}
                      disabled={pending}
                      className={`rounded-md border px-3 py-1 text-xs disabled:opacity-50 ${
                        c.is_active
                          ? "border-amber-900/50 text-amber-300 hover:border-amber-500"
                          : "border-emerald-900/50 text-emerald-300 hover:border-emerald-500"
                      }`}
                      title={c.is_active ? "Hide from /communities (reversible)" : "Show on /communities again"}
                    >
                      {c.is_active ? "Archive" : "Restore"}
                    </button>
                    <button
                      onClick={() => onDelete(c)}
                      disabled={pending}
                      className="rounded-md border border-red-900/50 px-3 py-1 text-xs text-red-300 hover:border-red-500 disabled:opacity-50"
                      title="Permanent delete. Type the name to confirm."
                    >
                      Delete forever
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function EditForm({
  community,
  pending,
  onSave,
  onCancel,
}: {
  community: ExternalCommunity;
  pending: boolean;
  onSave: (patch: {
    category?: ExtCategory;
    name?: string;
    href?: string;
    description?: string | null;
    sort_order?: number;
  }) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onSave({
          category: String(fd.get("category") ?? community.category) as ExtCategory,
          name: String(fd.get("name") ?? community.name).trim(),
          href: String(fd.get("href") ?? community.href).trim(),
          description: String(fd.get("description") ?? "").trim() || null,
          sort_order: Number(fd.get("sort_order") ?? community.sort_order),
        });
      }}
      className="space-y-3"
    >
      <label className="block">
        <span className="mb-1 block text-xs text-zinc-400">Category</span>
        <select
          name="category"
          defaultValue={community.category}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </label>
      <Field label="Name" name="name" defaultValue={community.name} required />
      <Field label="URL" name="href" type="url" defaultValue={community.href} required />
      <Field label="Description" name="description" textarea defaultValue={community.description ?? ""} />
      <Field label="Sort order" name="sort_order" type="number" defaultValue={String(community.sort_order)} />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-500"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label, name, type = "text", placeholder, defaultValue, required, textarea, hint,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  textarea?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-400">{label}</span>
      {textarea ? (
        <textarea
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          rows={3}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
      ) : (
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
        />
      )}
      {hint && <span className="mt-1 block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}
