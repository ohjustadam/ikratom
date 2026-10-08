"use client";

import { useChromeMe } from "@/components/chrome/ChromeProvider";

/**
 * The creator/admin "Edit" affordance.
 *
 * Client-side since 2026-09-08: resolving it on the server meant
 * getCreatorContext() — a cookie read — ran on every request, which made the
 * whole library page dynamic. Every crawler hit re-rendered the page against
 * Supabase to decide whether to show a link only staff can use.
 *
 * `isLeader` on the chrome read is exactly getCreatorContext()'s condition
 * (admin OR advocate leader). This is a UI affordance, not a security
 * boundary — /admin/library is guarded server-side, as it must be.
 */
export function CreatorEditLink({ itemId }: { itemId: string }) {
  const { isLeader } = useChromeMe();
  if (!isLeader) return null;
  return (
    <div className="mt-3">
      <a
        href={`/admin/library/${itemId}/edit`}
        className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:border-emerald-500"
      >
        Edit
      </a>
    </div>
  );
}
