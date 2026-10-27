"use client";

import { useState, useTransition } from "react";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { createWallComment, deleteWallComment, loadWallComments } from "../actions";
import { COMMENT_MAX, type WallComment } from "../types";
import { WallAuthor } from "./WallAuthor";

/** "N comments" → the thread, with Report on others' comments and a reply box. */
export function WallComments({ postId, count, viewerId }: { postId: string; count: number; viewerId: string | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<WallComment[] | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    setOpen((o) => !o);
    if (!items) start(async () => setItems(await loadWallComments(postId)));
  };
  const shown = items?.length ?? count;

  return (
    <div className="mt-3 border-t border-zinc-800 pt-2">
      <button type="button" onClick={toggle} className="text-xs text-zinc-400 hover:text-emerald-400">
        💬 {shown === 0 ? (viewerId ? "Comment" : "No comments") : `${shown} comment${shown === 1 ? "" : "s"}`}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {pending && !items && <p className="text-xs text-zinc-500">Loading…</p>}
          {items?.map((c) => (
            <div key={c.id} className="rounded-md bg-zinc-900/60 p-2">
              <WallAuthor id={c.author_id} username={c.author_username} avatarUrl={c.author_avatar_url} at={c.created_at} small />
              <p className="mt-1 whitespace-pre-line break-words text-sm text-zinc-200">{c.body}</p>
              <div className="mt-1 flex gap-3">
                {viewerId && c.author_id !== viewerId && <ReportButton targetType="wall_comment" targetId={c.id} />}
                {c.can_delete && (
                  <button type="button" className="text-xs text-zinc-500 hover:text-red-400"
                    onClick={() => start(async () => {
                      const r = await deleteWallComment(c.id);
                      if ("error" in r) setErr(r.error);
                      else setItems((xs) => (xs ?? []).filter((x) => x.id !== c.id));
                    })}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
          {viewerId && (
            <form className="flex gap-2" onSubmit={(e) => {
              e.preventDefault();
              setErr(null);
              start(async () => {
                const r = await createWallComment(postId, text);
                if ("error" in r) return setErr(r.error);
                setItems(r.comments);
                setText("");
              });
            }}>
              <label htmlFor={`c-${postId}`} className="sr-only">Write a comment</label>
              <input id={`c-${postId}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={COMMENT_MAX}
                placeholder="Write a comment…" className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm" />
              <button type="submit" disabled={pending || !text.trim()} className="rounded-md bg-zinc-800 px-3 text-xs font-semibold hover:bg-zinc-700 disabled:opacity-50">
                Reply
              </button>
            </form>
          )}
          {err && <p role="alert" className="text-xs text-red-400">{err}</p>}
        </div>
      )}
    </div>
  );
}
