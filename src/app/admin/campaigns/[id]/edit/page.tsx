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
  const { data: campaignRaw } = await supabase
    .from("campaigns")
    .select(
      "id, title, slug, blurb, body_md, state, target_roles, subject_template, body_template, active, briefing, briefing_generated_at"
    )
    .eq("id", id)
    .single();

  if (!campaignRaw) notFound();
  // Supabase generated types lag the migration that added briefing columns.
  // Just pull off the briefing fields and pass the rest through unchanged.
  const campaign = campaignRaw as typeof campaignRaw & {
    briefing: string | null;
    briefing_generated_at: string | null;
  };

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

      <BriefingPanel
        slug={campaign.slug}
        state={campaign.state}
        briefing={campaign.briefing}
        generatedAt={campaign.briefing_generated_at}
      />

      <CampaignForm initial={campaign} />
    </div>
  );
}

function BriefingPanel({
  slug, state, briefing, generatedAt,
}: {
  slug: string;
  state: string | null;
  briefing: string | null;
  generatedAt: string | null;
}) {
  if (!state) return null; // federal campaigns don't get briefings yet

  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">Research briefing</h2>
          <p className="text-xs text-zinc-500">
            AI-generated context for {state}: active bills, recent news,
            recommended legislators, talking points. Generate locally with{" "}
            <code className="rounded bg-zinc-900 px-1.5 py-0.5">
              npm run research:campaign -- --slug {slug}
            </code>
          </p>
        </div>
        {generatedAt && (
          <span className="shrink-0 rounded bg-zinc-900 px-2 py-1 text-[10px] text-zinc-400">
            {new Date(generatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {briefing ? (
        <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-4 text-xs leading-relaxed text-zinc-300">
          {briefing}
        </pre>
      ) : (
        <p className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
          No briefing yet. Run the command above on your laptop with Ollama
          running — the result will appear here.
        </p>
      )}
    </section>
  );
}
