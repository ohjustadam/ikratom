"use client";

import { useState, useTransition } from "react";
import {
  createCustomReminder,
  type ReminderTargetKind,
} from "@/modules/notifications/custom-reminders";

/**
 * Reusable "🔔 Remind me" button. Drops on any bill / meeting /
 * campaign / legislator / news page. Click opens an inline form
 * for date+time + custom message.
 *
 * Owner directive: "this is a weapon that needs to be precise" —
 * the form pre-fills sensible defaults so the user can fire a
 * reminder in 2 clicks: open, save.
 */
export function RemindMeButton({
  targetKind,
  targetId,
  defaultTitle,
  defaultMessage,
}: {
  targetKind: ReminderTargetKind;
  targetId: string | null;
  defaultTitle: string;
  defaultMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [remindAt, setRemindAt] = useState(() => defaultRemindAt());
  const [title, setTitle] = useState(defaultTitle.slice(0, 100));
  const [message, setMessage] = useState(defaultMessage ?? "");
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const r = await createCustomReminder({
        target_kind: targetKind,
        target_id: targetId,
        remind_at: new Date(remindAt).toISOString(),
        title,
        message: message || null,
      });
      if ("error" in r) {
        setFeedback(r.error);
      } else {
        setFeedback("✓ Reminder set");
        // Auto-close after a beat so the user sees confirmation
        setTimeout(() => { setOpen(false); setFeedback(null); }, 1500);
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-xs font-medium text-amber-300 transition hover:border-amber-500 hover:bg-amber-950/40"
      >
        🔔 Remind me
      </button>
    );
  }

  return (
    <div className="rounded-md border border-amber-700/40 bg-amber-950/15 p-3 text-xs">
      <p className="mb-2 font-semibold text-amber-300">Set a reminder</p>
      <label className="block">
        <span className="text-zinc-400">When</span>
        <input
          type="datetime-local"
          value={remindAt}
          min={localISOMinutesFromNow(5)}
          onChange={(e) => setRemindAt(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-100"
        />
      </label>
      <label className="mt-2 block">
        <span className="text-zinc-400">Title (push notification headline)</span>
        <input
          type="text"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-100"
        />
      </label>
      <label className="mt-2 block">
        <span className="text-zinc-400">Note (optional)</span>
        <textarea
          value={message}
          maxLength={500}
          rows={2}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What should I remind you to do?"
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950/60 px-2 py-1 text-zinc-100"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !title.trim() || !remindAt}
          className="rounded-md bg-amber-600 px-3 py-1 font-medium text-amber-50 hover:bg-amber-500 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save reminder"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setFeedback(null); }}
          className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-400 hover:border-zinc-500"
        >
          Cancel
        </button>
        {feedback && (
          <span className={feedback.startsWith("✓") ? "text-emerald-400" : "text-red-400"}>
            {feedback}
          </span>
        )}
      </div>
      <p className="mt-2 text-[10px] text-zinc-600">
        Push notification fires at the time you set. Manage all reminders at <a href="/reminders" className="underline">/reminders</a>.
      </p>
    </div>
  );
}

/**
 * Default reminder time: tomorrow at 9am local. Best default for
 * "I'll deal with this in the morning" — the most common use case.
 */
function defaultRemindAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalISO(d);
}

function localISOMinutesFromNow(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  return toLocalISO(d);
}

/** datetime-local input wants YYYY-MM-DDTHH:MM in LOCAL time, no Z. */
function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
