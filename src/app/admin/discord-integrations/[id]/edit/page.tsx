import { notFound, redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { getDiscordIntegration } from "@/modules/discord/actions";
import { EditDiscordIntegrationForm } from "./EditDiscordIntegrationForm";

export const metadata = { title: "Edit Discord integration" };

export default async function EditDiscordIntegrationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const { id } = await params;
  const r = await getDiscordIntegration(id);
  if ("error" in r || !r.integration) notFound();
  const integration = r.integration;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/discord-integrations" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Discord integrations
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">{integration.server_name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Slug <span className="font-mono text-zinc-300">{integration.server_slug}</span>{" "}
          · webhook locked (re-create the integration if it needs to change).
        </p>
      </header>

      <EditDiscordIntegrationForm initial={integration} />
    </div>
  );
}
