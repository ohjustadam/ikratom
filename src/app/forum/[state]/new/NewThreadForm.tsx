"use client";

import { useState, useTransition } from "react";
import { createThread } from "@/modules/forum/actions";
import { TAG_LABELS, type ForumTag } from "@/modules/forum/types";

const TAGS: ForumTag[] = ["general", "legislation", "news", "event", "meetup", "market"];

export function NewThreadForm({
  state,
  userIsLocal,
  communities,
}: {
  state: string;
  userIsLocal: boolean;
  communities: Array<{ id: string; slug: string; name: string; icon: string | null }>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [residentsOnly, setResidentsOnly] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("state", state);
    startTransition(async () => {
      const result = await createThread(fd);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-zinc-400">Title *</label>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="What's on your mind?"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Tag</label>
        <select
          name="tag"
          defaultValue="general"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        >
          {TAGS.map((t) => (
            <option key={t} value={t}>{TAG_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {communities.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-zinc-400">
            Community <span className="text-zinc-600">(optional — also list this thread in a topical community)</span>
          </label>
          <select
            name="community_id"
            defaultValue=""
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">— None —</option>
            {communities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon ? `${c.icon} ` : ""}{c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-zinc-400">
          Body <span className="text-zinc-600">(optional — adds context)</span>
        </label>
        <textarea
          name="body"
          rows={8}
          maxLength={20000}
          placeholder="Background, links, what you want to discuss…"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">
          Locality <span className="text-zinc-600">(optional — pin to a city/county)</span>
        </label>
        <input
          name="locality"
          maxLength={120}
          placeholder="Tulsa, OK  ·  or leave blank for state-wide"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {userIsLocal && (
        <label className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-sm">
          <input
            type="checkbox"
            name="residents_only"
            checked={residentsOnly}
            onChange={(e) => setResidentsOnly(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span>
            <span className="font-medium">Local strategy — replies from {state} residents only</span>
            <span className="block text-xs text-zinc-500">
              Out-of-state advocates can read but not reply (shop owners, medical pros, and advocate leaders are exempt).
            </span>
          </span>
        </label>
      )}

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
          {pending ? "Posting…" : "Post thread"}
        </button>
        <a href={`/forum/${state}`} className="text-sm text-zinc-400 hover:text-emerald-400">
          Cancel
        </a>
      </div>
    </form>
  );
}
