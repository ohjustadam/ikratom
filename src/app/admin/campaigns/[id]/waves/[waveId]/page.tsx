import { notFound, redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { WaveAdminPanel } from "./WaveAdminPanel";

export const metadata = { title: "Wave detail" };

type Wave = {
  id: string;
  campaign_id: string;
  title: string;
  description: string | null;
  scheduled_at: string;
  fired_at: string | null;
  active: boolean;
  target_signups: number | null;
  sent_count: number;
  failed_count: number;
  created_at: string;
};

type Signup = {
  id: string;
  user_id: string;
  joined_at: string;
  send_status: "pending" | "sent" | "failed" | "skipped" | "opted_out";
  send_error: string | null;
  sent_at: string | null;
};

export default async function WaveDetailPage({
  params,
}: {
  params: Promise<{ id: string; waveId: string }>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const { id: campaignId, waveId } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug, title")
    .eq("id", campaignId)
    .single();
  if (!campaign) notFound();

  const { data: waveRaw } = await supabase
    .from("campaign_waves")
    .select("id, campaign_id, title, description, scheduled_at, fired_at, active, target_signups, sent_count, failed_count, created_at")
    .eq("id", waveId)
    .eq("campaign_id", campaignId)
    .single();
  if (!waveRaw) notFound();
  const wave = waveRaw as unknown as Wave;

  const { data: signupsRaw } = await supabase
    .from("campaign_wave_signups")
    .select("id, user_id, joined_at, send_status, send_error, sent_at")
    .eq("wave_id", waveId)
    .order("joined_at", { ascending: true });
  const signups = (signupsRaw ?? []) as unknown as Signup[];

  // Look up display names for each signed-up user
  const userIds = Array.from(new Set(signups.map((s) => s.user_id)));
  const { data: profileRows } = userIds.length > 0
    ? await supabase.from("profiles").select("id, full_name, state").in("id", userIds)
    : { data: [] };
  const profiles = new Map<string, { name: string; state: string | null }>(
    ((profileRows ?? []) as Array<{ id: string; full_name: string | null; state: string | null }>).map((p) => [
      p.id,
      { name: p.full_name ?? "(no name)", state: p.state },
    ]),
  );

  const counts = {
    total: signups.length,
    pending: signups.filter((s) => s.send_status === "pending").length,
    sent: signups.filter((s) => s.send_status === "sent").length,
    failed: signups.filter((s) => s.send_status === "failed").length,
    skipped: signups.filter((s) => s.send_status === "skipped").length,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a
        href={`/admin/campaigns/${campaignId}/edit`}
        className="text-xs text-zinc-500 hover:text-emerald-400"
      >
        ← {campaign.title}
      </a>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Coalition wave
        </p>
        <h1 className="mt-1 text-3xl font-bold">{wave.title}</h1>
        {wave.description && (
          <p className="mt-2 text-sm text-zinc-400">{wave.description}</p>
        )}
        <p className="mt-3 text-xs text-zinc-500">
          Scheduled <span className="text-zinc-300">{new Date(wave.scheduled_at).toLocaleString()}</span>
          {wave.fired_at && (
            <> · fired <span className="text-emerald-300">{new Date(wave.fired_at).toLocaleString()}</span></>
          )}
          {!wave.active && !wave.fired_at && <> · <span className="text-amber-300">cancelled</span></>}
        </p>
      </header>

      {/* Stat strip */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat value={counts.total} label="Signups" />
        <Stat value={counts.sent} label="Sent" accent />
        <Stat value={counts.pending} label="Pending" />
        <Stat value={counts.failed} label="Failed" warn={counts.failed > 0} />
        <Stat value={counts.skipped} label="Skipped" />
      </section>

      <WaveAdminPanel
        wave={wave}
        signups={signups}
        profiles={Object.fromEntries(profiles)}
      />
    </div>
  );
}

function Stat({
  value, label, accent, warn,
}: { value: number; label: string; accent?: boolean; warn?: boolean }) {
  const cls = accent
    ? "border-emerald-700/50 bg-emerald-950/20"
    : warn
    ? "border-red-900/40 bg-red-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valueCls = accent ? "text-emerald-300" : warn ? "text-red-300" : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-3 text-center ${cls}`}>
      <div className={`text-2xl font-bold tabular-nums ${valueCls}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}
