"use client";

import Link from "next/link";
import { useTransition } from "react";
import type { CustomReminder } from "@/modules/notifications/custom-reminders";

/**
 * One row on the /reminders dashboard. Server actions are passed in
 * as props so this client component doesn't import "use server"
 * modules directly (server actions are still callable from client
 * via prop, the runtime serializes the call).
 */
export function CustomReminderRow({
  reminder,
  state,
  cancelAction,
  deleteAction,
}: {
  reminder: CustomReminder;
  state: "upcoming" | "overdue" | "fired" | "cancelled";
  cancelAction: (id: string) => Promise<{ ok: true } | { error: string }>;
  deleteAction: (id: string) => Promise<{ ok: true } | { error: string }>;
}) {
  const [pending, startTransition] = useTransition();

  const targetLink = (() => {
    switch (reminder.target_kind) {
      case "bill": return reminder.target_id ? `/bills/${reminder.target_id}` : null;
      case "meeting": return reminder.target_id ? `/meetings/${reminder.target_id}` : null;
      case "campaign": return reminder.target_id ? `/campaigns/${reminder.target_id}` : null;
      case "legislator": return reminder.target_id ? `/legislators/${reminder.target_id}/briefing` : null;
      case "news_item": return reminder.target_id ? `/news/${reminder.target_id}` : null;
      default: return null;
    }
  })();

  const dateStr = new Date(reminder.remind_at).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  const kindLabel = reminder.target_kind === "custom" ? "Custom" : reminder.target_kind.replace(/^./, c => c.toUpperCase());

  return (
    <li className="rounded border border-zinc-800 bg-zinc-950/40 p-2.5 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">{kindLabel}</span>
        <span className="font-semibold text-zinc-100">{reminder.title}</span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{dateStr}</span>
      </div>
      {reminder.message && (
        <p className="mt-1 text-[11px] text-zinc-400">{reminder.message}</p>
      )}
      <div className="mt-2 flex items-center gap-2 text-[10px]">
        {targetLink && (
          <Link href={targetLink} className="text-emerald-400 hover:underline">
            View {reminder.target_kind} →
          </Link>
        )}
        {(state === "upcoming" || state === "overdue") && (
          <button
            type="button"
            onClick={() => startTransition(async () => { await cancelAction(reminder.id); })}
            disabled={pending}
            className="ml-auto text-zinc-500 hover:text-amber-400 disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        {(state === "fired" || state === "cancelled") && (
          <button
            type="button"
            onClick={() => startTransition(async () => { await deleteAction(reminder.id); })}
            disabled={pending}
            className="ml-auto text-zinc-500 hover:text-red-400 disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
