"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeContent } from "../actions";
import {
  deleteForumPost,
  deleteForumThread,
  editForumPost,
  editForumThread,
  setThreadFlags,
} from "../edit-actions";
import type { ForumRights } from "@/lib/forum-permissions";

type Target = { targetType: "post" | "thread"; targetId: string };

const REVIEW_NOTE: Record<string, string> = {
  auto_flagged: "Saved. Your edit has a link or contact info, so a moderator will check it first.",
  pending: "Saved. A moderator will check it, the same as your first few posts.",
};

/** The inline editor for a post or a thread's opening text. */
export function EditForm({
  targetType,
  targetId,
  title,
  body,
  asModerator,
  onDone,
}: Target & { title?: string; body: string; asModerator: boolean; onDone: () => void }) {
  const router = useRouter();
  const [newTitle, setNewTitle] = useState(title ?? "");
  const [newBody, setNewBody] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const r =
        targetType === "post"
          ? await editForumPost({ postId: targetId, body: newBody })
          : await editForumThread({ threadId: targetId, title: newTitle, body: newBody });
      if ("error" in r) {
        setError(r.error);
        return;
      }
      const note = r.moderationStatus ? REVIEW_NOTE[r.moderationStatus] : undefined;
      if (note) window.alert(note);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="mt-2 space-y-2">
      {asModerator && (
        <p className="rounded-md border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          You&apos;re changing someone else&apos;s words. It will read &quot;edited by a moderator&quot;
          and the old text stays in the log.
        </p>
      )}
      {targetType === "thread" && (
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          maxLength={200}
          aria-label="Thread title"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-semibold focus:border-emerald-500 focus:outline-none"
        />
      )}
      <textarea
        value={newBody}
        onChange={(e) => setNewBody(e.target.value)}
        rows={6}
        maxLength={20000}
        aria-label="Your post"
        className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
      />
      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="text-xs text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Edit, Delete and Remove, shown only to the people each one is for. */
export function ContentButtons({
  targetType,
  targetId,
  rights,
  onEdit,
  afterDeleteHref,
}: Target & { rights: ForumRights; onEdit: () => void; afterDeleteHref?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function finish(r: { error?: string } | { ok: true }) {
    if ("error" in r && r.error) {
      setError(r.error);
      return;
    }
    if (afterDeleteHref) router.push(afterDeleteHref);
    else router.refresh();
  }

  function del() {
    if (!window.confirm(targetType === "post" ? "Delete this post?" : "Delete this thread?")) return;
    setError(null);
    startTransition(async () => {
      finish(
        targetType === "post"
          ? await deleteForumPost({ postId: targetId })
          : await deleteForumThread({ threadId: targetId }),
      );
    });
  }

  function remove() {
    const reason = window.prompt("Why is this coming down? Goes in the moderation log.");
    if (reason === null) return;
    setError(null);
    startTransition(async () => {
      finish(await removeContent({ targetType, targetId, reason: reason || undefined }));
    });
  }

  return (
    <>
      {rights.edit && (
        <button type="button" onClick={onEdit} className="text-zinc-500 hover:text-emerald-400">
          Edit
        </button>
      )}
      {rights.delete && (
        <button type="button" onClick={del} disabled={pending} className="text-zinc-500 hover:text-red-300">
          Delete
        </button>
      )}
      {rights.remove && (
        <button type="button" onClick={remove} disabled={pending} className="text-zinc-500 hover:text-red-300">
          Remove
        </button>
      )}
      {error && <span className="text-red-300">{error}</span>}
    </>
  );
}

/** Lock and pin, for moderators. */
export function ThreadModButtons({
  threadId,
  locked,
  pinned,
}: {
  threadId: string;
  locked: boolean;
  pinned: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(flags: { locked?: boolean; pinned?: boolean }) {
    setError(null);
    startTransition(async () => {
      const r = await setThreadFlags({ threadId, ...flags });
      if ("error" in r) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => set({ locked: !locked })}
        disabled={pending}
        className="text-zinc-500 hover:text-amber-300"
      >
        {locked ? "Unlock" : "Lock"}
      </button>
      <button
        type="button"
        onClick={() => set({ pinned: !pinned })}
        disabled={pending}
        className="text-zinc-500 hover:text-amber-300"
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      {error && <span className="text-red-300">{error}</span>}
    </>
  );
}
