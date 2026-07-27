import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listDiscordIntegrations } from "@/modules/discord/actions";
import { TestPostButton } from "./TestPostButton";

/**
 * /admin/discord-integrations — list of registered partner Discord servers.
 *
 * Each row links to edit + test-post + delete. Webhook URLs never shown
 * in plaintext (masked to last 4 chars of token only). The mask happens
 * here at render time, not in the DB.
 */
export const metadata = { title: "Discord integrations" };

export default async function DiscordIntegrationsPage() {
  const ctx = await getAdminContext({ require: "manage_discord" });
  if (!ctx.ok) redirect("/dashboard");

  const r = await listDiscordIntegrations();
  const rows = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Discord integrations</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Webhooks that auto-post bill alerts + campaign launches into partner Discord channels.
            Server admins paste their webhook URL; iKratom posts on their behalf.
          </p>
        </div>
        <a
          href="/admin/discord-integrations/new"
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          + Add server
        </a>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          No Discord servers connected yet. Add the first to start broadcasting alerts.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const masked = maskedWebhookForDisplay(r.webhook_url);
            const events = (r.events_enabled ?? []) as string[];
            return (
              <li
                key={r.id}
                className={`rounded-md border p-4 ${
                  r.active
                    ? "border-zinc-800 bg-zinc-950/40"
                    : "border-amber-800/40 bg-amber-950/10"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-zinc-100">{r.server_name}</span>
                  {r.channel_name && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      {r.channel_name}
                    </span>
                  )}
                  {r.state_filter && (
                    <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                      {r.state_filter}
                    </span>
                  )}
                  {!r.active && (
                    <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                      Disabled — needs reattention
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">
                    {r.total_posts.toLocaleString()} posts · {r.total_failures} failures
                  </span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">{masked}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                  <span className="text-zinc-600">Events:</span>
                  {events.length === 0 && <span className="text-zinc-700">none</span>}
                  {events.map((e) => (
                    <span key={e} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-400">
                      {e}
                    </span>
                  ))}
                  <span className="ml-auto flex gap-1.5">
                    <TestPostButton id={r.id} />
                    <a
                      href={`/admin/discord-integrations/${r.id}/edit`}
                      className="rounded-md border border-zinc-700 px-2 py-0.5 hover:border-zinc-500"
                    >
                      Edit
                    </a>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-8 text-xs text-zinc-600">
        Setup blueprint for the server itself: <code className="text-zinc-500">docs/DISCORD_SERVER_SETUP.md</code> ·
        Integration design: <code className="text-zinc-500">docs/DISCORD_INTEGRATION.md</code>
      </p>
    </div>
  );
}

function maskedWebhookForDisplay(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      parts[parts.length - 1] = last.length > 8 ? last.slice(0, 4) + "..." + last.slice(-4) : "****";
    }
    return `${u.host}${parts.join("/")}`;
  } catch {
    return "(invalid)";
  }
}
