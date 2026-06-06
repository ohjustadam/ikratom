"use client";

import { useEffect, useState, useTransition } from "react";
import { updateNotificationPrefs, type NotificationPrefs } from "../actions";

export function NotificationPrefsForm({ initial }: { initial: NotificationPrefs | null }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  // Capture the device's IANA time zone so the server can evaluate the
  // local-time quiet-hours window. Falls back to whatever was saved before.
  const [tz, setTz] = useState(initial?.timezone ?? "");
  useEffect(() => {
    try {
      const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (z) setTz(z);
    } catch {
      /* leave the saved value */
    }
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await updateNotificationPrefs(fd);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">What to notify me about</h3>
        <div className="mt-3 space-y-2 text-sm">
          <Check name="notify_federal_campaigns" defaultChecked={initial?.notify_federal_campaigns ?? true}>
            New federal campaigns (US Senate / House)
          </Check>
          <Check name="notify_state_campaigns" defaultChecked={initial?.notify_state_campaigns ?? true}>
            New campaigns in my state
          </Check>
          <Check name="notify_local_campaigns" defaultChecked={initial?.notify_local_campaigns ?? true}>
            New campaigns in my city or county
          </Check>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-zinc-100">How to deliver</h3>
        <div className="mt-3 space-y-2 text-sm">
          <Check name="in_app" defaultChecked={initial?.in_app ?? true}>
            In-app (bell icon + /notifications)
          </Check>
          <Check name="email" defaultChecked={initial?.email ?? false} disabled>
            Email <span className="ml-1 text-xs text-zinc-500">(coming with email integration)</span>
          </Check>
          <Check name="daily_brief_push" defaultChecked={initial?.daily_brief_push ?? false}>
            ☕ Daily brief push <span className="ml-1 text-xs text-zinc-500">(once-a-day summary, requires push enabled in browser)</span>
          </Check>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Quiet hours &amp; Do Not Disturb</h3>
        <p className="mt-1 text-xs text-zinc-500">
          We never buzz your device during these hours — notifications still wait
          for you in the inbox and arrive when the window ends. Uses your
          device&apos;s time zone{tz ? ` (${tz})` : ""}.
        </p>
        <div className="mt-3 space-y-3 text-sm">
          <Check name="dnd_enabled" defaultChecked={initial?.dnd_enabled ?? false}>
            🔕 Do Not Disturb — pause all push (your in-app inbox still fills)
          </Check>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">Quiet from</span>
              <input
                type="time"
                name="quiet_hours_start"
                defaultValue={(initial?.quiet_hours_start ?? "").slice(0, 5)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-zinc-400">until</span>
              <input
                type="time"
                name="quiet_hours_end"
                defaultValue={(initial?.quiet_hours_end ?? "").slice(0, 5)}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </label>
          </div>
          <p className="text-xs text-zinc-500">Leave both blank for no quiet window. A window like 22:00 → 07:00 wraps overnight.</p>
        </div>
        <input type="hidden" name="timezone" value={tz} readOnly />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-400">Cadence</label>
        <select
          name="digest"
          defaultValue={initial?.digest ?? "instant"}
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        >
          <option value="instant">Instant — notify the moment something matches</option>
          <option value="daily">Daily digest (planned)</option>
          <option value="weekly">Weekly digest (planned)</option>
          <option value="off">Off — turn off all notifications</option>
        </select>
      </div>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          Notification preferences saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save preferences"}
      </button>
    </form>
  );
}

function Check({
  name, defaultChecked, disabled, children,
}: { name: string; defaultChecked: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
      />
      {children}
    </label>
  );
}
