"use client";

import { useState, useTransition } from "react";
import { reportContent } from "../actions";

const CATEGORIES: Array<{ value: "spam" | "commercial" | "harassment" | "off_topic" | "misinformation" | "other"; label: string }> = [
  { value: "spam", label: "Spam" },
  { value: "commercial", label: "Selling product" },
  { value: "harassment", label: "Harassment / abuse" },
  { value: "off_topic", label: "Off-topic" },
  { value: "misinformation", label: "Misinformation" },
  { value: "other", label: "Other" },
];

export function ReportButton({
  targetType,
  targetId,
}: {
  targetType: "post" | "thread";
  targetId: string;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<typeof CATEGORIES[number]["value"]>("commercial");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await reportContent({
        targetType,
        targetId,
        reasonCategory: category,
        reason,
      });
      if ("error" in r) {
        setError(r.error ?? "Failed");
      } else {
        setDone(true);
        setReason("");
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setDone(false); }}
        className="text-zinc-600 hover:text-orange-400"
        title="Report this content"
      >
        Report
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-orange-900/40 bg-orange-950/10 p-3">
      {done ? (
        <div className="text-xs text-emerald-300">
          ✓ Reported. A moderator will review.
          <button
            onClick={() => { setOpen(false); setDone(false); }}
            className="ml-2 text-zinc-500 hover:text-zinc-300"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <p className="text-xs font-semibold text-orange-300">Report this {targetType}</p>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as typeof category)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs focus:border-orange-500 focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            placeholder="Optional details (max 500 chars)"
            rows={2}
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs focus:border-orange-500 focus:outline-none"
          />
          {error && (
            <p className="text-xs text-red-300">{error}</p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-orange-400 disabled:opacity-50"
            >
              {pending ? "…" : "Send report"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); }}
              disabled={pending}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
