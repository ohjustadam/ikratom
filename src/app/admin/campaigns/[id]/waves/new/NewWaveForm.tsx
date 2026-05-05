"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWave } from "@/modules/waves/actions";

export function NewWaveForm({
  campaignId,
  campaignSlug,
  campaignTitle,
}: {
  campaignId: string;
  campaignSlug: string;
  campaignTitle: string;
}) {
  // Default to 7 days from now at 9am local
  const defaultScheduled = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    // Build the "yyyy-MM-ddTHH:mm" format datetime-local wants
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [title, setTitle] = useState(`Wave: ${campaignTitle.slice(0, 80)}`);
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState(defaultScheduled);
  const [target, setTarget] = useState<string>("100");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const targetNum = parseInt(target, 10);
    startTransition(async () => {
      const r = await createWave({
        campaignId,
        title: title.trim(),
        description: description.trim() || undefined,
        scheduledAt: new Date(scheduledAt).toISOString(),
        targetSignups: Number.isFinite(targetNum) && targetNum > 0 ? targetNum : null,
      });
      if ("error" in r) {
        setError(r.error ?? "Failed");
      } else {
        router.push(`/campaigns/${campaignSlug}`);
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div>
        <label className="block text-xs font-medium text-zinc-400">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">Shown on the campaign page.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">When fires (your local time)</label>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          required
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          The wave fires within an hour of this time (cron runs hourly).
          Pick a time when legislators&apos; offices are open — Tuesday/Wednesday 9-11am
          local works best.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Signup goal (optional)</label>
        <input
          type="number"
          min={1}
          max={10000}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1 w-32 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Shown as &quot;47 / 100 advocates joined&quot;. Pure UI — wave fires
          regardless of whether goal is reached.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Description (optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          rows={4}
          placeholder="Why this wave matters. The bill, the vote date, what changed."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Scheduling…" : "Schedule wave"}
        </button>
        <a
          href={`/admin/campaigns/${campaignId}/edit`}
          className="text-sm text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </a>
      </div>

      <p className="rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-500">
        <strong className="text-zinc-300">What happens:</strong> users see a &quot;Join the wave&quot;
        button on the campaign page. To join they need their Gmail connected (waves send from each user&apos;s
        own Gmail). At fire time, the cron processes signups in batches of 30/hour; large waves complete over
        a few ticks.
      </p>
    </form>
  );
}
