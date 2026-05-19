import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getAdminContext } from "@/modules/admin/actions";
import { DiagnosticsClient } from "./DiagnosticsClient";

export const metadata = { title: "Connectivity diagnostics" };
export const dynamic = "force-dynamic";

/**
 * /admin/diagnostics — verify every external integration works.
 *
 * Single-page test panel. Each test fires on click + reports its
 * actual result inline. Used when something looks broken and you
 * need to isolate "is iKratom broken, or is the third-party down?"
 *
 * Tests included:
 *   - Supabase reachability + table read latency
 *   - Each Discord webhook integration (sends a literal test message)
 *   - Each AI provider (Groq / Gemini / Ollama)
 *   - Push notification to current admin's subscriptions
 *   - OAuth callback URLs (reachable check, doesn't actually auth)
 *   - Env-var sanity (owner-only; names only, never values)
 */
export default async function DiagnosticsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  // Pull the list of Discord integrations so we can render per-row test buttons.
  type DiscordRow = { id: string; server_name: string; channel_name: string; active: boolean; state_filter: string | null };
  let discordRows: DiscordRow[] = [];
  try {
    const sb = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data } = await sb
      .from("discord_integrations")
      .select("id, server_name, channel_name, active, state_filter")
      .order("server_name", { ascending: true });
    discordRows = (data ?? []) as DiscordRow[];
  } catch { /* defensive */ }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Diagnostics
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Connectivity diagnostics</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Verify every external integration is reachable + working. Use when something looks
          broken and you need to isolate the cause.
        </p>
      </header>

      <DiagnosticsClient
        discordRows={discordRows}
        isOwner={ctx.isOwner}
      />
    </div>
  );
}
