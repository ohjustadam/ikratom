"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { listNotifications, markNotificationRead, markAllRead } from "../actions";

/**
 * Facebook-style notification flyout. Click bell → panel slides
 * down. List in-page so users don't lose their work tab.
 *
 * Sources of notifications (subset for v1, per owner):
 *   - forum-reply-to-your-thread
 *   - intel-tip moderated (approved/rejected)
 *   - bill-status changed on a bill you're subscribed to
 *
 * Unread badge updates in real-time as user views the list.
 */

type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationFlyout({ initialUnreadCount }: { initialUnreadCount: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [unread, setUnread] = useState(initialUnreadCount);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement | null>(null);

  // Load on first open (lazy — server hit only when bell is clicked)
  useEffect(() => {
    if (!open || items !== null) return;
    listNotifications(20).then((rows) => setItems(rows as unknown as Notification[]));
  }, [open, items]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function onItemClick(n: Notification, e: React.MouseEvent) {
    if (n.link) {
      // Default <a> nav happens, but mark read first.
      // No e.preventDefault() — we want the navigation to proceed.
      // For safety on browsers that'd race the unmount, also fire
      // the action without awaiting.
    }
    if (!n.read_at) {
      startTransition(async () => {
        await markNotificationRead(n.id);
      });
      // Optimistic update
      setItems((prev) =>
        prev
          ? prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
          : prev,
      );
      setUnread((c) => Math.max(0, c - 1));
    }
    if (!n.link) {
      e.preventDefault();
    }
  }

  function onMarkAll() {
    startTransition(async () => {
      await markAllRead();
    });
    setItems((prev) =>
      prev ? prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) : prev,
    );
    setUnread(0);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-zinc-900"
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        aria-expanded={open}
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-zinc-950">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
            <h2 className="text-sm font-semibold text-zinc-100">Notifications</h2>
            {unread > 0 && (
              <button
                onClick={onMarkAll}
                className="text-[11px] text-emerald-400 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-2xl">📭</p>
                <p className="mt-2 text-sm text-zinc-400">All caught up.</p>
                <p className="mt-1 text-[11px] text-zinc-600">
                  We&apos;ll ping you here when there&apos;s a forum reply,
                  an intel-tip ruling, or a bill status change you&apos;re
                  watching.
                </p>
              </div>
            ) : (
              <ul>
                {items.map((n) => {
                  const isUnread = !n.read_at;
                  return (
                    <li
                      key={n.id}
                      className={`border-b border-zinc-800 last:border-b-0 ${
                        isUnread ? "bg-emerald-950/10" : ""
                      }`}
                    >
                      <a
                        href={n.link ?? "#"}
                        onClick={(e) => onItemClick(n, e)}
                        className="flex items-start gap-3 px-4 py-3 text-sm hover:bg-zinc-900"
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-base">
                          {iconForKind(n.kind)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`leading-snug ${isUnread ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
                            {n.title}
                          </p>
                          {n.body && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">
                              {n.body}
                            </p>
                          )}
                          <p className="mt-0.5 text-[10px] text-zinc-600">
                            {timeAgo(n.created_at)}
                          </p>
                        </div>
                        {isUnread && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-zinc-800 px-4 py-2 text-center">
            <a href="/notifications" className="text-[11px] text-zinc-500 hover:text-emerald-400">
              See all notifications →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function iconForKind(kind: string): string {
  switch (kind) {
    case "forum_reply":
    case "thread_reply":
    case "post_reply":
      return "💬";
    case "intel_tip_approved":
      return "✅";
    case "intel_tip_rejected":
      return "🚫";
    case "bill_status":
    case "bill_status_change":
      return "📋";
    case "new_campaign":
      return "📣";
    case "wave_fired":
      return "📨";
    case "meeting":
    case "meeting_reminder":
      return "📅";
    case "feedback_report":
      return "💬";
    default:
      return "🔔";
  }
}

function timeAgo(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const days = Math.floor(sec / 86400);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function BellIcon() {
  return (
    <svg className="h-5 w-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0" />
    </svg>
  );
}
