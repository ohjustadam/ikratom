"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createEmailPreset,
  updateEmailPreset,
  deleteEmailPreset,
  type EmailPreset,
} from "@/modules/email-presets/actions";

export function EmailPresetsPanel({ initial }: { initial: EmailPreset[] }) {
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
      const r = await createEmailPreset({
        name: String(fd.get("name") ?? ""),
        body: String(fd.get("body") ?? ""),
        signature: String(fd.get("signature") ?? ""),
        tone: (String(fd.get("tone") ?? "firm")) as "firm" | "pleading" | "business" | "personal",
        isDefault: fd.get("is_default") === "on",
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        formEl.reset();
        setShowForm(false);
        router.refresh();
      }
    });
  }

  function setDefault(p: EmailPreset) {
    startTransition(async () => {
      await updateEmailPreset({ id: p.id, isDefault: true });
      router.refresh();
    });
  }

  function onDelete(p: EmailPreset) {
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    startTransition(async () => {
      await deleteEmailPreset(p.id);
      router.refresh();
    });
  }

  return (
    <>
      {initial.length > 0 && (
        <ul className="mb-6 space-y-2">
          {initial.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-zinc-100">{p.name}</span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {p.tone}
                </span>
                {p.is_default && (
                  <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    default
                  </span>
                )}
                <span className="ml-auto flex gap-1.5">
                  {!p.is_default && (
                    <button
                      onClick={() => setDefault(p)}
                      disabled={pending}
                      className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:border-emerald-500 disabled:opacity-50"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(p)}
                    disabled={pending}
                    className="rounded-md border border-red-900/50 px-2 py-0.5 text-[11px] text-red-300 hover:border-red-700 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </span>
              </div>
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-xs text-zinc-300">
                {p.body}
              </pre>
              {p.signature && (
                <p className="mt-1 text-[11px] text-zinc-500">— {p.signature}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {showForm ? (
        <form onSubmit={onCreate} className="space-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300">Name</label>
            <input
              name="name"
              type="text"
              required
              placeholder="e.g. Personal — pain patient"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300">Body</label>
            <textarea
              name="body"
              rows={6}
              required
              placeholder="Dear {{legislator_name}},&#10;&#10;As a {{state}} resident who relies on kratom, I urge you to..."
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300">Signature (optional)</label>
            <input
              name="signature"
              type="text"
              placeholder="— Jane Smith, OK constituent"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-300">Tone</label>
              <select
                name="tone"
                className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="firm">Firm</option>
                <option value="pleading">Pleading</option>
                <option value="business">Business</option>
                <option value="personal">Personal</option>
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-xs">
              <input type="checkbox" name="is_default" className="h-4 w-4 rounded border-zinc-700 bg-zinc-950" />
              <span>Use as default</span>
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
              {pending ? "Saving…" : "Save preset"}
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
          disabled={initial.length >= 5}
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-emerald-500 disabled:opacity-50"
        >
          {initial.length >= 5 ? "Limit reached (5/5)" : "+ New preset"}
        </button>
      )}
    </>
  );
}
