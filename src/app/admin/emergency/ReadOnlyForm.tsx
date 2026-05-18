"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateReadOnlyMode, type EmergencyConfig } from "@/modules/admin/emergency-actions";

/**
 * Read-only-mode toggle. Distinct from emergency banner: this flips
 * the application-layer mutation gate. When ON, non-admins can't
 * write — they hit a soft "temporarily paused" message. Admins still
 * mutate normally so they can clean up whatever caused the lockdown.
 */
export function ReadOnlyForm({ initial }: { initial: EmergencyConfig }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.readOnlyMode);
  const [reason, setReason] = useState(initial.readOnlyReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const r = await updateReadOnlyMode({
        enabled,
        reason: reason.trim() || undefined,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-lg border border-amber-700/40 bg-amber-950/10 p-6"
    >
      <header>
        <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
          ⏸ Read-only mode
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Application-layer mutation gate. When ON, non-admin users get a soft &quot;temporarily paused&quot;
          message on every write (campaigns, stories, signups, coalition creates). Admins still
          operate normally. Use during spam waves, suspected compromise, or DB quota triage.
        </p>
      </header>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-amber-900/30 bg-zinc-950/40 p-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-zinc-700 bg-zinc-950 text-amber-500"
        />
        <span>
          <span className="block font-semibold text-amber-300">
            Read-only mode {enabled ? "ON" : "OFF"}
          </span>
          <span className="block text-xs text-zinc-400">
            {enabled
              ? "Non-admin writes will be refused with the reason shown below."
              : "Writes accepted as normal."}
          </span>
        </span>
      </label>

      <div>
        <label className="block text-xs font-medium text-zinc-400">
          Reason (optional, shown to users)
        </label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={280}
          placeholder="Spam wave triage — back in 1 hour"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-amber-500 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
