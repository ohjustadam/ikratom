"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pinGroupResource, removeGroupResource } from "@/modules/coalitions/resource-actions";
import { STARTER_TEMPLATE, TEMPLATE_PLACEHOLDERS, type ResourceKind } from "@/modules/coalitions/resources";

/** Organizers pin a link or a letter template (migration 0293). */
export function PinResourceForm({ coalitionId, slug }: { coalitionId: string; slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ResourceKind>("link");
  const [f, setF] = useState({ title: "", note: "", url: "", subject: STARTER_TEMPLATE.subject, body: STARTER_TEMPLATE.body });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const input = "mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-base text-zinc-100 focus:border-emerald-500 focus:outline-none sm:text-sm";

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="min-h-11 rounded-md border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-emerald-500">
        📌 Pin a link or template
      </button>
    );
  }
  return (
    <form className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await pinGroupResource(coalitionId, slug, { kind, ...f });
          if (!r.ok) { setError(r.error); return; }
          setOpen(false);
          setF({ title: "", note: "", url: "", subject: STARTER_TEMPLATE.subject, body: STARTER_TEMPLATE.body });
          router.refresh();
        });
      }}>
      <div role="radiogroup" aria-label="What to pin" className="grid grid-cols-2 gap-2">
        {(["link", "template"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`min-h-11 rounded-md border text-sm font-semibold ${kind === k ? "border-emerald-500 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
            {k === "link" ? "🔗 Link" : "✍️ Letter template"}
          </button>
        ))}
      </div>
      <label className="block text-xs text-zinc-400">Title
        <input value={f.title} onChange={set("title")} maxLength={120} required className={input}
          placeholder={kind === "link" ? "e.g. Submit testimony for HB 1234" : "e.g. Testimony: regulate, don't ban"} />
      </label>
      {kind === "link" && (
        <label className="block text-xs text-zinc-400">Web address
          <input value={f.url} onChange={set("url")} type="url" inputMode="url" required placeholder="https://" className={input} />
        </label>
      )}
      {kind === "template" && (
        <>
          <label className="block text-xs text-zinc-400">Subject
            <input value={f.subject} onChange={set("subject")} maxLength={200} className={input} />
          </label>
          <label className="block text-xs text-zinc-400">Letter
            <textarea value={f.body} onChange={set("body")} maxLength={5000} rows={10} required className={input} />
          </label>
          <p className="text-[11px] text-zinc-500">
            Filled in for each member and official: {TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. Write ___ wherever each member should add their own words.
          </p>
        </>
      )}
      <label className="block text-xs text-zinc-400">Note (optional)
        <textarea value={f.note} onChange={set("note")} maxLength={500} rows={2} className={input}
          placeholder="When to use it, or the deadline" />
      </label>
      {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
          {pending ? "Pinning…" : "Pin it"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-3 text-sm text-zinc-400">Cancel</button>
      </div>
    </form>
  );
}

export function RemoveResourceButton({ id, slug }: { id: string; slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" disabled={pending} className="text-zinc-500 hover:text-red-300"
        onClick={() => {
          if (!confirm("Unpin this for everyone?")) return;
          start(async () => {
            const r = await removeGroupResource(id, slug);
            if (!r.ok) setError(r.error); else router.refresh();
          });
        }}>
        {pending ? "Removing…" : "Unpin"}
      </button>
      {error && <span className="text-amber-300">{error}</span>}
    </>
  );
}

/** For a hearing's testimony portal: copy the letter text to paste there. */
export function CopyTemplateButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); } catch { setDone(false); } }}
      className="min-h-11 rounded-md border border-zinc-700 px-3 text-sm text-zinc-200 hover:border-emerald-500">
      {done ? "✓ Copied" : "📋 Copy the text"}
    </button>
  );
}
