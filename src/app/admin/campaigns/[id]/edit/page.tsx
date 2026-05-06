import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { CampaignForm } from "@/modules/admin/components/CampaignForm";
import { listWavesForCampaign } from "@/modules/waves/actions-admin";

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
        <div className="flex flex-wrap gap-2">
          <a
            href={`/admin/campaigns/${campaign.id}/stats`}
            className="rounded-md border border-emerald-700/50 bg-emerald-950/20 px-3 py-1.5 text-sm text-emerald-300 hover:border-emerald-500"
          >
            📊 Analytics
          </a>
          <a
            href={`/admin/campaigns/${campaign.id}/waves/new`}
            className="rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500"
          >
            ⚡ Schedule wave
          </a>
          <a
            href={`/campaigns/${campaign.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500"
          >
            Preview ↗
          </a>
        </div>
      </header>

      <BriefingPanel
        slug={campaign.slug}
        state={campaign.state}
        briefing={campaign.briefing}
        generatedAt={campaign.briefing_generated_at}
      />

      <WaveHistoryPanel campaignId={campaign.id} />

      <CampaignForm initial={campaign} />
    </div>
  );
}

async function WaveHistoryPanel({ campaignId }: { campaignId: string }) {
  const waves = await listWavesForCampaign(campaignId);
  if (waves.length === 0) {
    return (
      <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Coalition waves</h2>
            <p className="text-xs text-zinc-500">
              No waves scheduled yet. Schedule one to coordinate a coalition send.
            </p>
          </div>
          <a
            href={`/admin/campaigns/${campaignId}/waves/new`}
            className="shrink-0 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500"
          >
            ⚡ Schedule wave
          </a>
        </div>
      </section>
    );
  }
  return (
    <section className="mb-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Coalition waves</h2>
          <p className="text-xs text-zinc-500">
            Click a wave to see signups, retry failures, or cancel.
          </p>
        </div>
        <a
          href={`/admin/campaigns/${campaignId}/waves/new`}
          className="shrink-0 rounded-md border border-amber-700/50 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-300 hover:border-amber-500"
        >
          + New wave
        </a>
      </div>
      <ul className="overflow-hidden rounded-md border border-zinc-800">
        {waves.map((w, i) => {
          const status = w.fired_at
            ? { label: "Fired", cls: "bg-emerald-950/40 text-emerald-300" }
            : !w.active
              ? { label: "Cancelled", cls: "bg-zinc-900 text-zinc-500" }
              : { label: "Scheduled", cls: "bg-amber-950/40 text-amber-300" };
          return (
            <li
              key={w.id}
              className={`flex flex-wrap items-center gap-3 bg-zinc-950/40 px-4 py-3 text-sm ${
                i > 0 ? "border-t border-zinc-900" : ""
              }`}
            >
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${status.cls}`}>
                {status.label}
              </span>
              <a
                href={`/admin/campaigns/${campaignId}/waves/${w.id}`}
                className="flex-1 truncate text-zinc-200 hover:text-emerald-400"
              >
                {w.title}
              </a>
              <span className="text-xs text-zinc-500">
                {new Date(w.scheduled_at).toLocaleDateString()}
              </span>
              <span className="text-xs tabular-nums text-zinc-400">
                {w.signup_count} signup{w.signup_count === 1 ? "" : "s"}
                {w.fired_at && (
                  <>
                    {" · "}
                    <span className="text-emerald-400">{w.sent_count} sent</span>
                    {w.failed_count > 0 && (
                      <span className="text-red-400"> · {w.failed_count} failed</span>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
