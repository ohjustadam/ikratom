"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitStory } from "@/modules/stories/actions";

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];
const TAGS: Array<{ id: "pain" | "recovery" | "mental_health" | "energy" | "medical_pro" | "shop_owner" | "family" | "veteran" | "other"; label: string }> = [
  { id: "pain", label: "Chronic pain" },
  { id: "recovery", label: "Recovery from opioids" },
  { id: "mental_health", label: "Mental health" },
  { id: "energy", label: "Energy / focus" },
  { id: "medical_pro", label: "Medical professional" },
  { id: "shop_owner", label: "Shop owner" },
  { id: "family", label: "Family member" },
  { id: "veteran", label: "Veteran" },
  { id: "other", label: "Other" },
];

export function NewStoryForm({ defaultName, defaultState }: { defaultName: string; defaultState: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [displayName, setDisplayName] = useState(defaultName);
  const [state, setState] = useState(defaultState);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleTag(id: string) {
    setTags((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : prev.length >= 5 ? prev : [...prev, id],
    );
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const r = await submitStory({
        title,
        body,
        anonymous,
        displayName: anonymous ? undefined : displayName,
        state: state || null,
        tags: tags as ("pain" | "recovery" | "mental_health" | "energy" | "medical_pro" | "shop_owner" | "family" | "veteran" | "other")[],
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/stories?submitted=1");
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
      <div>
        <label className="block text-xs font-medium text-zinc-400">Title *</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          placeholder="One sentence — what's this story about?"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Your story *</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          minLength={80}
          maxLength={10000}
          rows={10}
          placeholder="Tell it like you'd tell a friend. Be specific. Be honest."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          {body.length}/10,000 characters · min 80
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Tags (pick up to 5)</label>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggleTag(t.id)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                tags.includes(t.id)
                  ? "bg-emerald-500 font-semibold text-zinc-950"
                  : "border border-zinc-800 text-zinc-400 hover:border-emerald-500"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-zinc-400">Your state (optional)</label>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
          >
            <option value="">—</option>
            {STATES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-zinc-500">Helps match your story to legislator outreach in your state.</p>
        </div>
      </div>

      <div className="rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span className="text-sm text-zinc-200">Post anonymously</span>
        </label>
        {!anonymous && (
          <div className="mt-3">
            <label className="block text-xs font-medium text-zinc-400">Display name (shown publicly)</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder="First name + last initial works great"
              className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
        )}
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
          {pending ? "Submitting…" : "Submit for review"}
        </button>
        <a href="/stories" className="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
      </div>

      <p className="text-xs text-zinc-500">
        Stories go through a review queue (usually approved within a day) before
        appearing on /stories. You&apos;ll get a notification when yours is live.
      </p>
    </form>
  );
}
