"use client";

import { useState, useTransition } from "react";
import { createEvent } from "@/modules/events/actions";

export function NewEventForm({ states }: { states: string[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createEvent(fd);
      if (r && "error" in r && r.error) setError(r.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-400">State *</label>
          <select
            name="state"
            required
            defaultValue=""
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">Event type *</label>
          <select
            name="event_type"
            required
            defaultValue="town_hall"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="town_hall">Town hall</option>
            <option value="public_hearing">Public hearing</option>
            <option value="listening_session">Listening session</option>
            <option value="committee_hearing">Committee hearing</option>
            <option value="floor_vote">Floor vote</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Title *</label>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Sen. Smith town hall on health policy"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Locality (optional)</label>
        <input
          name="locality"
          maxLength={120}
          placeholder="Tulsa, OK"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-400">Starts at *</label>
          <input
            type="datetime-local"
            name="starts_at"
            required
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400">Ends at (optional)</label>
          <input
            type="datetime-local"
            name="ends_at"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Venue (optional)</label>
        <input
          name="venue"
          maxLength={300}
          placeholder="City Hall, 200 N State St, Tulsa OK 74103"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Description (optional)</label>
        <textarea
          name="description"
          rows={4}
          maxLength={2000}
          placeholder="What kratom-related questions advocates should bring."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Source URL (optional)</label>
        <input
          type="url"
          name="source_url"
          maxLength={1000}
          placeholder="https://senator-smith.gov/events/2026-05-15"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Hosting legislator ID (optional)</label>
        <input
          name="legislator_id"
          placeholder="UUID from /legislators if known"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Posting…" : "Post event"}
      </button>
    </form>
  );
}
