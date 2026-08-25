import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { CampaignWizard } from "@/modules/admin/components/CampaignWizard";

import Link from "next/link";
export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; from_thread?: string }>;
}) {
  const ctx = await getCreatorContext({ require: "author_campaigns" });
  if (!ctx.ok) redirect("/dashboard");

  const sp = await searchParams;
  const supabase = await createClient();

  // Forum thread → campaign: when a leader hits "Turn into campaign" on a
  // hot thread, prefill the wizard with the thread's state + draft body.
  let prefill: { state: string | null; title: string; bodyMd: string } | null = null;
  if (sp.from_thread && /^[0-9a-f-]{36}$/i.test(sp.from_thread)) {
    const { data: thread } = await supabase
      .from("forum_threads")
      .select("title, body, state, locality")
      .eq("id", sp.from_thread)
      .single();
    if (thread) {
      const t = thread as { title: string; body: string | null; state: string | null; locality: string | null };
      prefill = {
        state: t.state,
        title: `Take action: ${t.title.slice(0, 160)}`,
        bodyMd: [
          t.body?.trim() || "",
          "",
          `(Spawned from a ${t.state ?? "national"} forum discussion. Edit before publishing.)`,
        ].join("\n").trim(),
      };
    }
  }

  // Pull all legislators with metadata the wizard needs
  const { data: legislators } = await supabase
    .from("legislators")
    .select(
      "id,full_name,role,level,state,district,locality,title,party,email,phone"
    )
    .eq("active", true)
    .order("state")
    .order("locality")
    .order("full_name");

  const wizardData = (legislators ?? []).map((l) => ({
    ...l,
    hasContact: !!(l.email || l.phone),
  }));

  // Distinct localities for autocomplete
  const localities = Array.from(
    new Set(
      (legislators ?? [])
        .map((l) => l.locality)
        .filter((x): x is string => !!x)
    )
  ).sort();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/campaigns" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Campaigns
      </Link>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">New campaign</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Three steps. Pick your scope, your targets, your message — we wire the action
          UI up so users can send with one click.
        </p>
      </header>
      {prefill && (
        <div className="mb-6 rounded-md border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs text-emerald-200">
          📨 Prefilled from a forum thread. Tweak the message and ship it.
        </div>
      )}
      <CampaignWizard
        legislators={wizardData}
        localities={localities}
        prefill={prefill ?? undefined}
      />
    </div>
  );
}
