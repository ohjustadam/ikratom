"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseHandle } from "../handle-actions";

/**
 * Shown to a member still on the automatic @member_… handle: one field, one
 * tap, and everyone sees the new name from then on. Renders nothing for anyone
 * else, so a page can drop it in unconditionally.
 */
export function ChooseHandle({ current }: { current: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (saved) {
    return (
      <p role="status" className="mb-4 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 text-sm text-emerald-200">
        ✓ You&apos;re now <strong>@{saved}</strong> everywhere on iKratom.
      </p>
    );
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await chooseHandle(value);
      if ("error" in r) { setError(r.error); return; }
      setSaved(r.handle);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="mb-4 rounded-lg border border-amber-700/40 bg-amber-950/20 p-3 sm:p-4">
      <p className="text-sm text-amber-100">
        Other members see you as <strong className="wrap-anywhere">@{current.replace(/^@/, "")}</strong>, a name we made up when
        your account was created. Pick the handle you want them to see. Your real name stays private.
      </p>
      <div className="mt-2 flex gap-2">
        <label className="flex min-w-0 flex-1 items-center rounded-md border border-zinc-700 bg-zinc-950 px-2 focus-within:border-emerald-500">
          <span className="text-zinc-500">@</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase())}
            placeholder="your_handle"
            aria-label="New handle"
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            maxLength={30}
            className="min-h-11 w-full min-w-0 bg-transparent px-1 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none sm:text-sm"
          />
        </label>
        <button type="submit" disabled={pending || value.trim().length < 3}
          className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">3–30 characters: lowercase letters, numbers and _.</p>
      {error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
    </form>
  );
}
