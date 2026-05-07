"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkDeleteChatMessages,
  muteUserFromChat,
  unmuteUserFromChat,
  clearOldLoungeMessages,
} from "@/modules/admin/lounge-actions";

/**
 * Owner / admin chat moderation surface.
 *
 * Three tools:
 *   1. Bulk-delete checked messages
 *   2. Mute a message's author for 1h / 24h / forever (unmute = clear)
 *   3. Clear messages older than N hours (or the whole room)
 *
 * After every mutation we router.refresh() so the server-rendered list
 * comes back fresh with the action's effect (deletion gone, mute badge on).
 */

type Message = {
  id: string;
  user_id: string;
  room: string;
  body: string;
  created_at: string;
  author_name: string | null;
  author_is_muted: boolean;
};

type MutedUser = {
  id: string;
  full_name: string | null;
  chat_muted_until: string | null;
};

export function LoungeModerationPanel({
  initialMessages,
  initialMuted,
}: {
  initialMessages: Message[];
  initialMuted: MutedUser[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(initialMessages.map((m) => m.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function bulkDelete() {
    if (selected.size === 0) {
      setError("Select at least one message.");
      return;
    }
    if (!confirm(`Delete ${selected.size} message${selected.size === 1 ? "" : "s"}?`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await bulkDeleteChatMessages(Array.from(selected));
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setInfo(`Deleted ${r.deleted}.`);
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function muteAuthor(userId: string, name: string | null, hours: number | "forever") {
    const label =
      hours === "forever"
        ? "permanently"
        : hours >= 24
        ? `for ${hours / 24} day${hours === 24 ? "" : "s"}`
        : `for ${hours} hour${hours === 1 ? "" : "s"}`;
    if (!confirm(`Mute ${name ?? userId} from chat ${label}?`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await muteUserFromChat({ userId, hours });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setInfo(`Muted ${name ?? userId} ${label}.`);
        router.refresh();
      }
    });
  }

  function unmute(userId: string, name: string | null) {
    if (!confirm(`Unmute ${name ?? userId}?`)) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await unmuteUserFromChat(userId);
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setInfo(`Unmuted ${name ?? userId}.`);
        router.refresh();
      }
    });
  }

  function clearOlder(hoursOld: number) {
    const label =
      hoursOld === 0
        ? "ALL messages in this room (full nuke)"
        : `messages older than ${hoursOld} hour${hoursOld === 1 ? "" : "s"}`;
    if (!confirm(`Permanently delete ${label}?`)) return;
    if (hoursOld === 0 && !confirm("Really? This cannot be undone.")) return;
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await clearOldLoungeMessages(hoursOld);
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setInfo(`Cleared ${r.deleted} message${r.deleted === 1 ? "" : "s"}.`);
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* Bulk action bar */}
      <div className="sticky top-2 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-700/40 bg-zinc-950/95 p-3 backdrop-blur">
        <span className="text-xs font-semibold uppercase tracking-wider text-amber-300">
          Bulk
        </span>
        <button
          onClick={selectAll}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-emerald-500"
        >
          Select all
        </button>
        <button
          onClick={clearSelection}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500"
        >
          Clear ({selected.size})
        </button>
        <button
          onClick={bulkDelete}
          disabled={pending || selected.size === 0}
          className="rounded-md bg-red-600/80 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-40"
        >
          Delete selected
        </button>

        <span className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => clearOlder(24)}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-amber-500 disabled:opacity-40"
          >
            Clear &gt; 24h old
          </button>
          <button
            onClick={() => clearOlder(168)}
            disabled={pending}
            className="rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-amber-500 disabled:opacity-40"
          >
            Clear &gt; 1 week old
          </button>
          <button
            onClick={() => clearOlder(0)}
            disabled={pending}
            className="rounded-md border border-red-900/50 px-2 py-1 text-xs text-red-300 hover:border-red-700 disabled:opacity-40"
          >
            Nuke all
          </button>
        </span>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {info && (
        <p className="mb-3 rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-300">
          {info}
        </p>
      )}

      {/* Currently muted users */}
      {initialMuted.length > 0 && (
        <section className="mb-6 rounded-lg border border-amber-700/30 bg-zinc-950/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-300">
            Currently muted ({initialMuted.length})
          </h2>
          <ul className="space-y-1.5 text-xs">
            {initialMuted.map((u) => {
              const until = u.chat_muted_until ? new Date(u.chat_muted_until) : null;
              const isForever = until && until.getFullYear() > 9000;
              return (
                <li key={u.id} className="flex flex-wrap items-center gap-2">
                  <a href={`/profile/${u.id}`} target="_blank" rel="noreferrer" className="text-zinc-200 hover:text-emerald-400">
                    {u.full_name ?? "(no name)"}
                  </a>
                  <span className="text-zinc-600">until</span>
                  <span className="font-mono text-zinc-400">
                    {isForever ? "forever" : until?.toLocaleString()}
                  </span>
                  <button
                    onClick={() => unmute(u.id, u.full_name)}
                    disabled={pending}
                    className="ml-auto rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] hover:border-emerald-500 disabled:opacity-40"
                  >
                    Unmute
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Messages list */}
      {initialMessages.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          Lounge has no messages.
        </div>
      ) : (
        <ul className="space-y-2">
          {initialMessages.map((m) => {
            const isSel = selected.has(m.id);
            return (
              <li
                key={m.id}
                className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                  isSel ? "border-amber-700/50 bg-amber-950/10" : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSel}
                  onChange={() => toggle(m.id)}
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
                  aria-label="Select message"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <a
                      href={`/profile/${m.user_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-emerald-300 hover:underline"
                    >
                      {m.author_name ?? "(no name)"}
                    </a>
                    {m.author_is_muted && (
                      <span className="rounded bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        muted
                      </span>
                    )}
                    <span>{new Date(m.created_at).toLocaleString()}</span>
                    <span className="font-mono text-zinc-700">{m.id.slice(0, 8)}</span>
                  </div>
                  <p className="mt-1 break-words text-zinc-200">{m.body}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {!m.author_is_muted && (
                      <>
                        <button
                          onClick={() => muteAuthor(m.user_id, m.author_name, 1)}
                          disabled={pending}
                          className="rounded-md border border-zinc-700 px-2 py-0.5 hover:border-amber-500 disabled:opacity-40"
                        >
                          Mute 1h
                        </button>
                        <button
                          onClick={() => muteAuthor(m.user_id, m.author_name, 24)}
                          disabled={pending}
                          className="rounded-md border border-zinc-700 px-2 py-0.5 hover:border-amber-500 disabled:opacity-40"
                        >
                          Mute 24h
                        </button>
                        <button
                          onClick={() => muteAuthor(m.user_id, m.author_name, "forever")}
                          disabled={pending}
                          className="rounded-md border border-red-900/50 px-2 py-0.5 text-red-300 hover:border-red-700 disabled:opacity-40"
                        >
                          Mute forever
                        </button>
                      </>
                    )}
                    {m.author_is_muted && (
                      <button
                        onClick={() => unmute(m.user_id, m.author_name)}
                        disabled={pending}
                        className="rounded-md border border-zinc-700 px-2 py-0.5 hover:border-emerald-500 disabled:opacity-40"
                      >
                        Unmute
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
