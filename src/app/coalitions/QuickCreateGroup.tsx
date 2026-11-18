"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/Link";
import { createCoalition } from "@/modules/coalitions/actions";

/**
 * Start a group from the Groups page in one step: a name, then Start. The new
 * group is private and scoped to the member's state, like the full form's
 * defaults; they land on it, where the welcome checklist takes over. The full
 * form (description, state, public listing) stays one link away.
 */
export function QuickCreateGroup({ defaultState }: { defaultState: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createCoalition({ name, state: defaultState || null, is_public: false });
      if (!res.ok) { setError(res.error); return; }
      router.push(`/coalitions/${res.slug}`);
    });
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <label htmlFor="quick-group-name" className="text-sm font-semibold text-zinc-100">Start a group</label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="quick-group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          maxLength={80}
          placeholder={defaultState ? `${defaultState} Kratom Advocates` : "Kratom Advocates of …"}
          className="min-h-11 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || name.trim().length < 2}
          className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Starting…" : "Start group"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Private until you list it. You can invite people with one tap once it&apos;s made.{" "}
        <Link href="/coalitions/new" className="text-zinc-400 hover:text-emerald-400">More options →</Link>
      </p>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
    </form>
  );
}
