import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { NewWaveForm } from "./NewWaveForm";

export const metadata = { title: "Schedule a wave" };

export default async function NewWavePage({
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
    .select("id, slug, title, state, active")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  // Existing active wave?
  const { data: existing } = await supabase
    .from("campaign_waves")
    .select("id, title, scheduled_at")
    .eq("campaign_id", id)
    .eq("active", true)
    .is("fired_at", null)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={`/admin/campaigns/${id}/edit`}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← Edit campaign
      </a>
      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Coalition mode
        </p>
        <h1 className="mt-2 text-3xl font-bold">Schedule a wave</h1>
        <p className="mt-3 text-sm text-zinc-400">
          A wave is a coordinated send. Advocates sign up between now and the
          scheduled time, and at fire time everyone&apos;s email goes out in a
          compressed window. Legislator staffers tally inbound — 50 emails in
          the same hour weighs more than 50 scattered over a week.
        </p>
      </header>

      {existing ? (
        <div className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5">
          <h2 className="text-base font-semibold text-amber-300">
            There&apos;s already an active wave for this campaign
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            <strong>{existing.title}</strong> — fires{" "}
            {new Date(existing.scheduled_at).toLocaleString()}
          </p>
          <p className="mt-3 text-xs text-zinc-500">
            One active wave per campaign at a time. Cancel the existing one if
            you need to start a new one.
          </p>
          <a
            href={`/campaigns/${campaign.slug}`}
            className="mt-4 inline-block rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-emerald-500"
          >
            View on campaign page →
          </a>
        </div>
      ) : (
        <NewWaveForm
          campaignId={campaign.id}
          campaignSlug={campaign.slug}
          campaignTitle={campaign.title}
        />
      )}
    </div>
  );
}
