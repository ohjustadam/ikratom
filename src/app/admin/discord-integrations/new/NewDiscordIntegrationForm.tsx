"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createDiscordIntegration } from "@/modules/discord/actions";

const ALL_EVENTS: { id: string; label: string; description: string }[] = [
  { id: "bill_drop_hostile", label: "Hostile bill drops", description: "Anti-kratom bills introduced (recommended)" },
  { id: "bill_drop_friendly", label: "Friendly bill drops", description: "Pro-kratom or KCPA-style bills" },
  { id: "campaign_launch", label: "Campaign launches", description: "When admin publishes a new campaign (recommended)" },
  { id: "wave_fire", label: "Wave fires", description: "When a scheduled email batch sends" },
  { id: "federal_action_moment", label: "Federal action moments", description: "DEA / FDA news with action urgency" },
];

export function NewDiscordIntegrationForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [events, setEvents] = useState<string[]>(["bill_drop_hostile", "campaign_launch"]);

  function toggleEvent(id: string) {
    setEvents((cur) => (cur.includes(id) ? cur.filter((e) => e !== id) : [...cur, id]));
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await createDiscordIntegration({
        webhookUrl: String(fd.get("webhook_url") ?? ""),
        serverName: String(fd.get("server_name") ?? ""),
        channelName: String(fd.get("channel_name") ?? ""),
        events,
        stateFilter: String(fd.get("state_filter") ?? ""),
      });
      if ("error" in r) setError(r.error ?? "Failed");
      else router.push("/admin/discord-integrations");
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="webhook_url" className="block text-sm font-medium text-zinc-300">
          Webhook URL
        </label>
        <input
          id="webhook_url"
          name="webhook_url"
          type="text"
          required
          placeholder="https://discord.com/api/webhooks/123.../abc..."
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-zinc-500">
          From the Discord server admin: Server Settings → Integrations → Webhooks → Copy URL. Treat this like a password.
        </p>
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
            placeholder="Kratom Connect"
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="state_filter" className="block text-sm font-medium text-zinc-300">
            State filter (optional)
          </label>
          <input
            id="state_filter"
            name="state_filter"
            type="text"
            placeholder="e.g. OK"
            maxLength={2}
            className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm uppercase text-zinc-100 focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        State filter limits this integration to bills/campaigns for one state. Leave blank for everything.
      </p>

      <div>
        <label htmlFor="channel_name" className="block text-sm font-medium text-zinc-300">
          Channel name (optional, for display)
        </label>
        <input
          id="channel_name"
          name="channel_name"
          type="text"
          placeholder="#kratom-bills"
          className="mt-1 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-300">Events to post</legend>
        <ul className="mt-2 space-y-1">
          {ALL_EVENTS.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={events.includes(e.id)}
                onChange={() => toggleEvent(e.id)}
                className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950"
              />
              <span>
                <span className="font-semibold text-zinc-200">{e.label}</span>
                <span className="ml-2 text-zinc-500">{e.description}</span>
              </span>
            </li>
          ))}
        </ul>
      </fieldset>

      {error && (
        <p className="rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Connecting…" : "Connect server"}
        </button>
        <a
          href="/admin/discord-integrations"
          className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:border-zinc-500"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}
