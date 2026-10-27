"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWallPost } from "../actions";

/** For the post's author and the wall's owner (delete_wall_post re-checks). */
export function WallDeleteButton({ postId, ownerId }: { postId: string; ownerId: string }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" disabled={pending} className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
        onClick={() => {
          if (!confirm("Delete this post? Its photo and comments go with it.")) return;
          start(async () => {
            const r = await deleteWallPost(postId, ownerId);
            if ("error" in r) setErr(r.error);
            else router.refresh();
          });
        }}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {err && <span role="alert" className="text-xs text-red-400">{err}</span>}
    </>
  );
}
