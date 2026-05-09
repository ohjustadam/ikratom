"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createCommunity,
  updateCommunity,
  archiveCommunity,
  unarchiveCommunity,
  countCommunityThreads,
  hardDeleteCommunity,
  type Community,
} from "@/modules/forum/community-actions";

/**
 * Admin CRUD panel for forum communities. One row per community with
 * inline edit toggle. New-row form lives at the top.
 *
 * Uses startTransition + router.refresh() so the server action's
 * revalidatePath flushes the list without a manual reload.
 */
export function CommunitiesPanel({ initial }: { initial: Community[] }) {
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
      const r = await createCommunity({
        slug: String(fd.get("slug") ?? "").trim().toLowerCase(),
        name: String(fd.get("name") ?? "").trim(),
        description: String(fd.get("description") ?? "").trim() || undefined,
        icon: String(fd.get("icon") ?? "").trim() || undefined,
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

  function onArchive(id: string, isActive: boolean) {
    if (isActive && !confirm("Archive this community? It will stop appearing in /forum and the public slug will 404. The row stays so existing threads keep their tag — use 'Delete forever' on archived communities to fully remove.")) return;
    startTransition(async () => {
      const r = isActive
        ? await archiveCommunity({ id })
        : await unarchiveCommunity({ id });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.refresh();
    });
  }

  async function onHardDelete(c: Community) {
    setError(null);
    // Look up the live thread count first so we can warn about orphaning.
    const r = await countCommunityThreads(c.id);
    if ("error" in r) {
      setError(r.error ?? "Failed to count threads");
      return;
    }
    const threadCount = r.count ?? 0;
    const msg = threadCount > 0
      ? `Permanently delete "${c.name}"?\n\n${threadCount} thread${threadCount === 1 ? "" : "s"} currently tagged to this community. They will NOT be deleted — they'll just lose the community tag and become uncategorized.\n\nThis cannot be undone. Type the slug "${c.slug}" to confirm.`
      : `Permanently delete "${c.name}"?\n\nNo threads reference this community.\n\nThis cannot be undone. Type the slug "${c.slug}" to confirm.`;
    const typed = prompt(msg);
    if (typed !== c.slug) {
      if (typed !== null) setError(`Confirmation didn't match (expected "${c.slug}"). Cancelled.`);
      return;
    }
    startTransition(async () => {
      const r2 = await hardDeleteCommunity({ id: c.id, confirmedThreadCount: threadCount });
      if ("error" in r2) setError(r2.error ?? "Failed");
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
          + New community
        </button>
      )}

      {showForm && (
        <form
          onSubmit={onCreate}
          className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">New community</h2>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null); }}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
          <Field label="Slug (URL)" name="slug" placeholder="veterans" required hint="2-40 chars, lowercase letters/digits/hyphens. Becomes /forum/c/<slug>." />
          <Field label="Name" name="name" placeholder="Veterans" required hint="2-60 chars. Shown on the community card and page header." />
          <Field label="Icon (optional)" name="icon" placeholder="🎖" hint="One emoji or short string." />
          <Field label="Description (optional)" name="description" textarea hint="500 chars max. One-liner on what this community is for." />
          <Field label="Sort order" name="sort_order" type="number" defaultValue="100" hint="Lower numbers appear first. Default 100." />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {pending ? "Saving…" : "Create community"}
          </button>
        </form>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-900/50 bg-red-950/20 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {initial.length === 0 ? (
        <p className="text-sm text-zinc-500">No communities yet. Create one above.</p>
      ) : (
        <ul className="space-y-2">
          {initial.map((c) => (
            <li
              key={c.id}
              className={`rounded-md border p-3 ${
                c.is_active ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-900 bg-zinc-950/20 opacity-60"
              }`}
            >
              {editing === c.id ? (
                <EditForm
                  community={c}
                  pending={pending}
                  onSave={(patch) =>
                    startTransition(async () => {
                      const r = await updateCommunity({ id: c.id, ...patch });
                      if ("error" in r) setError(r.error ?? "Failed");
                      else { setEditing(null); router.refresh(); }
                    })
                  }
                  onCancel={() => { setEditing(null); setError(null); }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-2xl">{c.icon || "💬"}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-zinc-100">{c.name}</span>
                      <span className="font-mono text-[11px] text-zinc-500">/forum/c/{c.slug}</span>
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
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => { setEditing(c.id); setError(null); }}
                      className="rounded-md border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:border-emerald-500"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onArchive(c.id, c.is_active)}
                      disabled={pending}
                      className={`rounded-md border px-3 py-1 text-xs disabled:opacity-50 ${
                        c.is_active
                          ? "border-amber-900/50 text-amber-300 hover:border-amber-500"
                          : "border-emerald-900/50 text-emerald-300 hover:border-emerald-500"
                      }`}
                      title={c.is_active
                        ? "Soft delete — hides from /forum, keeps row so existing threads stay tagged. Reversible."
                        : "Bring this community back to /forum."
                      }
                    >
                      {c.is_active ? "Archive" : "Restore"}
                    </button>
                    <button
                      onClick={() => onHardDelete(c)}
                      disabled={pending}
                      className="rounded-md border border-red-900/50 px-3 py-1 text-xs text-red-300 hover:border-red-500 disabled:opacity-50"
                      title="Permanently delete this community. Existing threads survive but lose their community tag."
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
  community: Community;
  pending: boolean;
  onSave: (patch: {
    slug?: string;
    name?: string;
    description?: string | null;
    icon?: string | null;
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
          slug: String(fd.get("slug") ?? community.slug).trim().toLowerCase(),
          name: String(fd.get("name") ?? community.name).trim(),
          description: String(fd.get("description") ?? "").trim() || null,
          icon: String(fd.get("icon") ?? "").trim() || null,
          sort_order: Number(fd.get("sort_order") ?? community.sort_order),
        });
      }}
      className="space-y-3"
    >
      <Field label="Slug" name="slug" defaultValue={community.slug} required />
      <Field label="Name" name="name" defaultValue={community.name} required />
      <Field label="Icon" name="icon" defaultValue={community.icon ?? ""} />
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
