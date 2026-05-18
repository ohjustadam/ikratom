"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCoalition } from "@/modules/coalitions/actions";

export function CreateCoalitionForm({ defaultState }: { defaultState: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState(defaultState);
  const [isPublic, setIsPublic] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCoalition({
        name,
        description: description || null,
        state: state || null,
        is_public: isPublic,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/coalitions/${res.slug}`);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={80}
          placeholder="OK Kratom Advocates"
          className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
          Description <span className="text-zinc-500 font-normal normal-case">(optional)</span>
        </span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Who's in this group + what you're organizing around."
          className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
          State <span className="text-zinc-500 font-normal normal-case">(optional — leave blank for national/multi-state)</span>
        </span>
        <input
          type="text"
          value={state}
          onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
          maxLength={2}
          placeholder="OK"
          className="mt-1 w-24 rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm font-mono uppercase text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-xs text-zinc-300">
          <span className="font-semibold">List publicly</span> on /coalitions.
          <span className="block text-[10px] text-zinc-500">
            Anyone can see the coalition exists + its description. Member names stay private to
            members. Default off.
          </span>
        </span>
      </label>

      {error && (
        <p className="rounded border border-red-700/40 bg-red-950/15 px-3 py-2 text-[11px] text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create coalition"}
      </button>
    </form>
  );
}
