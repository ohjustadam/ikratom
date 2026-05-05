import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { CampaignWizard } from "@/modules/admin/components/CampaignWizard";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();

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
      <a href="/admin/campaigns" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Campaigns
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">New campaign</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Three steps. Pick your scope, your targets, your message — we wire the action
          UI up so users can send with one click.
        </p>
      </header>
      <CampaignWizard legislators={wizardData} localities={localities} />
    </div>
  );
}
