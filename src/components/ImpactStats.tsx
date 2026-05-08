import { createClient } from "@/lib/supabase/server";

/**
 * Public impact dashboard — homepage social proof.
 *
 * Server component. Numbers come from the SECURITY DEFINER RPC
 * `public.homepage_stats()`, which bypasses RLS and returns only
 * aggregate counts (no PII). This was originally six per-table count()
 * queries, but two of those tables (profiles, campaign_actions) have
 * self-only SELECT policies — anon visitors saw 0 advocates and 0
 * emails because RLS evaluated against rows-visible-to-anon (none).
 *
 * One RPC call now does what six queries used to. See migration 0048.
 *
 * All counts are aggregate — no PII, safe for public/anon view.
 */

type HomepageStats = {
  advocates: number;
  emails_sent: number;
  calls_made: number;
  active_campaigns: number;
  active_anti_bills: number;
  states_with_campaigns: number;
};

export async function ImpactStats() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homepage_stats");
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    return null;
  }
  const s = data[0] as HomepageStats;

  // Hide the section entirely until there's real data to show — an empty
  // scoreboard is worse than no scoreboard.
  if (
    s.emails_sent === 0 &&
    s.calls_made === 0 &&
    s.active_campaigns === 0 &&
    s.active_anti_bills === 0 &&
    s.advocates === 0
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
        <Stat value={s.emails_sent} label="Emails sent" accent />
        {s.calls_made > 0 && <Stat value={s.calls_made} label="Calls made" />}
        <Stat value={s.active_campaigns} label="Active campaigns" />
        <Stat
          value={s.active_anti_bills}
          label="Anti-kratom bills tracked"
          warn={s.active_anti_bills > 0}
        />
        <Stat value={s.states_with_campaigns} label="States with campaigns" />
        <Stat value={s.advocates} label="Advocates registered" />
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
