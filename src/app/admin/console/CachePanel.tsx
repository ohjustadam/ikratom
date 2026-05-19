"use client";

import { useState, useTransition } from "react";
import { flushCacheTag, revalidateAdminPath, type CacheResult } from "@/modules/admin/console-actions";

const COMMON_PATHS = [
  "/",
  "/support",
  "/ethics",
  "/how-it-works",
  "/brief",
  "/now",
  "/intel",
  "/intel/operations",
  "/pulse",
] as const;

/**
 * Cache invalidation panel — flush named tags or revalidate paths.
 *
 * Two operations:
 *   1. Flush tag — invalidates everything tagged with that string.
 *      Currently only "editable-content" is wired into the platform.
 *   2. Revalidate path — forces a specific route to rebuild on next
 *      request. Useful after DB edits to force the page to pick up
 *      the change immediately (otherwise waits for natural TTL).
 *
 * Both are safe to spam — no destructive effects, worst case you
 * cause a few extra origin hits.
 */
export function CachePanel() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CacheResult | null>(null);
  const [customPath, setCustomPath] = useState("");

  function flush(tag: "editable-content") {
    setResult(null);
    startTransition(async () => {
      const r = await flushCacheTag(tag);
      setResult(r);
    });
  }

  function revalidate(path: string) {
    setResult(null);
    startTransition(async () => {
      const r = await revalidateAdminPath(path);
      setResult(r);
    });
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
        ♻ Cache invalidation
      </h2>
      <p className="mt-1 text-[11px] text-zinc-400">
        Force a cache miss so the next page load rebuilds from fresh data. Use after manual DB
        edits when the natural ~60s TTL feels slow.
      </p>

      <div className="mt-3">
        <p className="text-[11px] font-semibold text-zinc-300">Flush cache tags</p>
        <button
          type="button"
          onClick={() => flush("editable-content")}
          disabled={pending}
          className="mt-1 min-h-[40px] rounded-md bg-emerald-500 px-3 py-1.5 text-[11px] font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          Flush <code>editable-content</code>
        </button>
        <p className="mt-1 text-[10px] text-zinc-500">
          Use after editing copy in <code>/admin/content</code> if the change hasn&apos;t shown up
          on the public page yet.
        </p>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold text-zinc-300">Revalidate path</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {COMMON_PATHS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => revalidate(p)}
              disabled={pending}
              className="rounded border border-zinc-700 bg-zinc-950/40 px-2 py-1 text-[10px] font-mono text-zinc-300 hover:border-emerald-500 disabled:opacity-40"
            >
              {p}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (customPath.trim()) revalidate(customPath.trim());
          }}
          className="mt-2 flex gap-2"
        >
          <input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/custom/path"
            className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] font-mono text-zinc-100"
          />
          <button
            type="submit"
            disabled={pending || !customPath.trim()}
            className="rounded bg-zinc-800 px-3 py-1.5 text-[11px] hover:bg-zinc-700 disabled:opacity-40"
          >
            Revalidate
          </button>
        </form>
      </div>

      {result && !result.ok && (
        <p className="mt-3 rounded border border-red-700/40 bg-red-950/20 px-3 py-2 text-[11px] text-red-200">
          ✗ {result.error}
        </p>
      )}
      {result && result.ok && (
        <p className="mt-3 rounded border border-emerald-700/40 bg-emerald-950/15 px-3 py-2 text-[11px] text-emerald-200">
          ✓ {result.action}
        </p>
      )}
    </section>
  );
}
