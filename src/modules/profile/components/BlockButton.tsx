"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockUser } from "@/modules/dm/block-actions";

/**
 * Block a member from their profile (or a DM). The block is platform-wide:
 * can_view_audience hides everything both ways, and any connection between
 * the two of you is removed. Unblock under Account → Security & privacy.
 */
export function BlockButton({ userId, handle, className }: { userId: string; handle: string; className?: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Block ${handle}? They won't be able to see your profile, photos or activity, and you won't see theirs.`)) return;
          start(async () => {
            const r = await blockUser(userId);
            if (r && "error" in r && r.error) setErr(r.error);
            else router.refresh();
          });
        }}
        className={className ?? "text-xs text-zinc-500 underline-offset-2 hover:text-red-400 hover:underline disabled:opacity-50"}
      >
        {pending ? "Blocking…" : "Block"}
      </button>
      {err && <span role="alert" className="text-xs text-red-400">{err}</span>}
    </>
  );
}
