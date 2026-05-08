"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateDiscordIntegration,
  deleteDiscordIntegration,
  type DiscordIntegration,
} from "@/modules/discord/actions";

const ALL_EVENTS = [
  { id: "bill_drop_hostile", label: "Hostile bill drops" },
  { id: "bill_drop_friendly", label: "Friendly bill drops" },
  { id: "bill_status_change", label: "Bill status changes" },
  { id: "campaign_launch", label: "Campaign launches" },
  { id: "wave_fire", label: "Wave fires" },
  { id: "federal_action_moment", label: "Federal action moments" },
];

export function EditDiscordIntegrationForm({ initial }: { initial: DiscordIntegration }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [events, setEvents] = useState<string[]>(initial.events_enabled);
  const [active, setActive] = useState<boolean>(initial.active);

  function toggleEvent(id: string) {
    setEvents((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await updateDiscordIntegration({
        id: initial.id,
        serverName: String(fd.get("server_name") ?? ""),
        channelName: String(fd.get("channel_name") ?? ""),
        events,
        stateFilter: String(fd.get("state_filter") ?? ""),
        active,
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else {
        setInfo("Saved.");
        router.refresh();
      }
    });
  }

  function onDelete() {
    if (!confirm(`Delete this integration? This will not delete the webhook in Discord — that's the server admin's call.`)) return;
    setError(null);
    startTransition(async () => {
      const r = await deleteDiscordIntegration(initial.id);
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/admin/discord-integrations");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
          />
          <span className={active ? "text-emerald-300" : "text-amber-300"}>
            {active ? "Active — posting" : "Inactive — paused"}
          </span>
        </label>
        <span className="ml-auto text-xs text-zinc-500">
          {initial.total_posts.toLocaleString()} posts · {initial.total_failures} failures
          {initial.consecutive_failures > 0 && (
            <span className="ml-2 text-amber-400">
              ({initial.consecutive_failures} consecutive failures)
            </span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label htmlFor="server_name" className="block text-sm font-medium text-zinc-300">
            Server name
          </label>
          <input
            id="server_name"
            name="server_name"
            type="text"
            required
            defaultValue={initial.server_name}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="state_filter" className="block text-sm font-medium text-zinc-300">
            State filter
          </label>
          <input
            id="state_filter"
            name="state_filter"
            type="text"
            defaultValue={initial.state_filter ?? ""}
            placeholder="OK"
            maxLength={2}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm uppercase text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label htmlFor="channel_name" className="block text-sm font-medium text-zinc-300">
          Channel name (display only)
        </label>
        <input
          id="channel_name"
          name="channel_name"
          type="text"
          defaultValue={initial.channel_name ?? ""}
          placeholder="#kratom-bills"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-300">Events</legend>
        <ul className="mt-2 space-y-1">
          {ALL_EVENTS.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs"
            >
              <input
                type="checkbox"
                checked={events.includes(e.id)}
                onChange={() => toggleEvent(e.id)}
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span className="font-semibold text-zinc-200">{e.label}</span>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>
      )}
      {info && (
        <p className="rounded-md border border-emerald-900/40 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          {info}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="ml-auto rounded-md border border-red-900/50 px-4 py-2 text-sm text-red-300 hover:border-red-700 disabled:opacity-50"
        >
          Delete integration
        </button>
      </div>
    </form>
  );
}
