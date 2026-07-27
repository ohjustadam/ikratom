import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { NewDiscordIntegrationForm } from "./NewDiscordIntegrationForm";

export const metadata = { title: "Add Discord integration" };

export default async function NewDiscordIntegrationPage() {
  const ctx = await getAdminContext({ require: "manage_discord" });
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/discord-integrations" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Discord integrations
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Connect a Discord server</h1>
        <p className="mt-1 text-sm text-zinc-400">
          The server admin creates a webhook in their channel of choice (Server Settings → Integrations → Webhooks → New Webhook).
          Paste that URL here. We post bill alerts + campaign launches into that channel; the admin can revoke at any time
          by deleting the webhook in Discord.
        </p>
      </header>

      <NewDiscordIntegrationForm />
    </div>
  );
}
