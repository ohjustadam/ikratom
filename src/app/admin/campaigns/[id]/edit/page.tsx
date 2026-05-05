import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "@/modules/admin/components/CampaignForm";

export const metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const { id } = await params;
  const supabase = await createClient();
  const { data: campaign } = await supabase
    .from("campaigns")
    .select(
      "id, title, slug, blurb, body_md, state, target_roles, subject_template, body_template, active"
    )
    .eq("id", id)
    .single();

  if (!campaign) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/campaigns" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Campaigns
      </a>
      <header className="mt-2 mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Edit campaign</h1>
          <p className="mt-2 text-sm text-zinc-400">
            <span className="font-mono">{campaign.slug}</span>
          </p>
        </div>
        <a
          href={`/campaigns/${campaign.slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500"
        >
          Preview ↗
        </a>
      </header>
      <CampaignForm initial={campaign} />
    </div>
  );
}
