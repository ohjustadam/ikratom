"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllRead, markNotificationRead } from "@/modules/notifications/actions";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [localRead, setLocalRead] = useState<Set<string>>(new Set());

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center">
        <p className="text-sm text-zinc-400">No notifications yet.</p>
        <p className="mt-2 text-xs text-zinc-500">
          When campaigns drop in your state or city, they show up here.
        </p>
      </div>
    );
  }

  const unreadCount = items.filter(
    (i) => !i.read_at && !localRead.has(i.id)
  ).length;

  function onClick(item: Item) {
    if (!item.read_at && !localRead.has(item.id)) {
      setLocalRead((s) => new Set([...s, item.id]));
      startTransition(async () => {
        await markNotificationRead(item.id);
      });
    }
    if (item.link) router.push(item.link);
  }

  function onMarkAll() {
    setLocalRead(new Set(items.map((i) => i.id)));
    startTransition(async () => {
      await markAllRead();
      router.refresh();
    });
  }

  return (
    <div>
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-zinc-400">{unreadCount} unread</span>
          <button
            onClick={onMarkAll}
            disabled={pending}
            className="text-xs text-emerald-400 hover:underline"
          >
            Mark all read
          </button>
        </div>
      )}

      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800">
        {items.map((item) => {
          const isRead = !!item.read_at || localRead.has(item.id);
          return (
            <li key={item.id}>
              <button
                onClick={() => onClick(item)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-zinc-900 ${
                  isRead ? "bg-zinc-950/40" : "bg-emerald-950/10"
                }`}
              >
                <span
                  className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                    isRead ? "bg-zinc-700" : "bg-emerald-500"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${isRead ? "text-zinc-400" : "font-medium text-zinc-100"}`}>
                    {item.title}
                  </p>
                  {item.body && (
                    <p className="mt-0.5 truncate text-xs text-zinc-500">{item.body}</p>
                  )}
                  <p className="mt-1 text-[11px] text-zinc-600">
                    {new Date(item.created_at).toLocaleString()}
                  </p>
                </div>
                {item.link && <span className="text-xs text-zinc-500">→</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
