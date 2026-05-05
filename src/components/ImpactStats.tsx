import { createClient } from "@/lib/supabase/server";

/**
 * Public impact dashboard — homepage social proof.
 *
 * Server component. Counts are fetched fresh per request (no caching) so
 * the numbers reflect reality. For a v1 scale this is fine; if homepage
 * traffic ever spikes we'd add a 60-second revalidate or a materialized
 * view.
 *
 * All counts are aggregate — no PII, safe for public/anon view.
 */
export async function ImpactStats() {
  const supabase = await createClient();

  // Run all counts in parallel
  const [
    actionsCount,
    callsCount,
    activeCampaigns,
    activeAntiBills,
    membersCount,
    statesWithCampaigns,
  ] = await Promise.all([
    supabase.from("campaign_actions").select("id", { count: "exact", head: true }),
    supabase
      .from("campaign_actions")
      .select("id", { count: "exact", head: true })
      .eq("method", "call"),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("kratom_relevance", "anti")
      .not("status", "in", "(enacted,dead)"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("campaigns")
      .select("state")
      .eq("active", true)
      .not("state", "is", null),
  ]);

  const distinctStates = new Set(
    (statesWithCampaigns.data ?? []).map((r: { state: string | null }) => r.state).filter(Boolean) as string[],
  ).size;

  // For the "emails sent" headline we exclude calls so it tells a clean story
  const emails = (actionsCount.count ?? 0) - (callsCount.count ?? 0);
  const calls = callsCount.count ?? 0;

  // Hide the section entirely until there's real data to show — an empty
  // scoreboard is worse than no scoreboard.
  if (
    emails === 0 &&
    calls === 0 &&
    (activeCampaigns.count ?? 0) === 0 &&
    (activeAntiBills.count ?? 0) === 0
  ) {
    return null;
  }

  return (
    <section className="mt-16">
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Live impact
        </p>
        <h2 className="mt-1 text-2xl font-bold sm:text-3xl">
          What the war room has done so far
        </h2>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat value={emails} label="Emails sent" accent />
        {calls > 0 && <Stat value={calls} label="Calls made" />}
        <Stat value={activeCampaigns.count ?? 0} label="Active campaigns" />
        <Stat
          value={activeAntiBills.count ?? 0}
          label="Anti-kratom bills tracked"
          warn={(activeAntiBills.count ?? 0) > 0}
        />
        <Stat value={distinctStates} label="States with campaigns" />
        <Stat value={membersCount.count ?? 0} label="Advocates registered" />
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  accent,
  warn,
}: {
  value: number;
  label: string;
  accent?: boolean;
  warn?: boolean;
}) {
  const cls = accent
    ? "border-emerald-700/50 bg-emerald-950/20"
    : warn
    ? "border-red-900/40 bg-red-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valueCls = accent
    ? "text-emerald-300"
    : warn
    ? "text-red-300"
    : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-4 text-center ${cls}`}>
      <div className={`text-3xl font-bold tabular-nums sm:text-4xl ${valueCls}`}>
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-zinc-500">
        {label}
      </div>
    </div>
  );
}
