"use client";

import { useEffect, useState } from "react";
import Link from "@/components/Link";

/**
 * The closed state of the floating Lounge: a "Groups" button that opens a
 * short explainer (linking /connect and the group directory) and the Lounge
 * button with a new-message badge. Owner ask 2026-10-28.
 */
export function LoungeLauncher({
  anchor,
  unread,
  onOpenLounge,
}: {
  anchor: string;
  unread: number;
  onOpenLounge: () => void;
}) {
  const [groupsOpen, setGroupsOpen] = useState(false);

  useEffect(() => {
    if (!groupsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGroupsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [groupsOpen]);

  const pill =
    "flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg transition";

  return (
    <div className={`${anchor} z-40 flex items-end gap-2`}>
      {groupsOpen && (
        <div
          role="dialog"
          aria-label="Groups and friends"
          className="absolute bottom-full right-0 mb-2 w-[min(19rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-700/40 bg-zinc-950 p-4 text-sm shadow-2xl shadow-black/60"
        >
          <p className="font-semibold text-zinc-100">👥 Groups and friends</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-zinc-400">
            <li>• Start or join a group for your town or state, with its own chat, events and a weekly action.</li>
            <li>• Add friends and choose who sees your profile and photos.</li>
            <li>• You always appear as your @username, never your real name.</li>
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href="/connect"
              onClick={() => setGroupsOpen(false)}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              See how it works →
            </Link>
            <Link
              href="/coalitions"
              onClick={() => setGroupsOpen(false)}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-emerald-500"
            >
              Find a group
            </Link>
            <button onClick={() => setGroupsOpen(false)} className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">
              Not now
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setGroupsOpen((v) => !v)}
        aria-label="Groups and friends: how it works"
        aria-expanded={groupsOpen}
        className={`${pill} border border-zinc-700 bg-zinc-900 text-zinc-100 shadow-black/40 hover:border-emerald-500`}
      >
        <span aria-hidden>👥</span>
        <span className="hidden sm:inline">Groups</span>
      </button>

      <button
        onClick={onOpenLounge}
        aria-label={unread > 0 ? `Open the Lounge live chat, ${unread} new messages` : "Open the Lounge live chat"}
        className={`${pill} relative border border-emerald-700/40 bg-emerald-600 text-white shadow-emerald-950/40 hover:bg-emerald-500`}
      >
        <span aria-hidden>💬</span>
        <span className="hidden sm:inline">Lounge</span>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full border-2 border-zinc-950 bg-red-500 px-1 text-center text-[11px] font-bold leading-[1.1rem] text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}
