import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Reveal } from "@/components/motion/Reveal";

export const metadata = {
  title: "All 50 states · iKratom",
  description: "Kratom policy by state — every active bill, upcoming meeting, and recent alert in one place per state.",
};
// Per-state counts are fully public + identical for everyone → cached across
// requests (see getStateStats below). No per-request dynamic flag needed; the
// page is dynamic anyway via the root layout's auth read.

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",DC:"D.C.",
  FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",
  IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",
  SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",
  WY:"Wyoming",
};

/**
 * /states — index of all 50 + DC state landing pages with activity badges.
 * Each tile links to /states/[code] which surfaces bills + meetings +
 * alerts + campaigns for that state.
 *
 * Activity badges show what's hot per state so visitors can find the
 * states with active kratom policy at a glance.
 */
type StateStats = Record<string, { bills: number; meetings: number; alerts: number }>;

// Public per-state activity counts, cached across requests (10-min revalidate)
// instead of 3 table scans on every /states view. Service-role client because
// the data is public and unstable_cache can't use the cookie-bound request
// client; the cached value is just the small counts map.
const getStateStats = unstable_cache(
  async (): Promise<StateStats> => {
    const supabase = createServiceRoleClient();
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 86_400_000).toISOString();
    const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

    const [bills, meetings, alerts] = await Promise.all([
      supabase.from("bills").select("state").eq("active", true).in("kratom_relevance", ["anti", "pro"]),
      supabase.from("municipal_meetings").select("state")
        .eq("moderation_status", "approved")
        .gte("meeting_at", now.toISOString()).lte("meeting_at", horizon),
      supabase.from("policy_alerts").select("locality")
        .eq("moderation_status", "approved")
        .in("severity", ["critical", "alert"])
        .gte("created_at", since30d),
    ]);

    const stats: StateStats = {};
    for (const code of Object.keys(STATE_NAMES)) {
      stats[code] = { bills: 0, meetings: 0, alerts: 0 };
    }
    for (const r of bills.data ?? []) {
      const s = (r.state as string | null)?.toUpperCase();
      if (s && stats[s]) stats[s].bills++;
    }
    for (const r of meetings.data ?? []) {
      const s = (r.state as string | null)?.toUpperCase();
      if (s && stats[s]) stats[s].meetings++;
    }
    for (const r of alerts.data ?? []) {
      const loc = (r.locality as string | null)?.trim() ?? "";
      let code: string | null = null;
      if (/^[A-Z]{2}$/.test(loc)) code = loc;
      else {
        const m = loc.match(/,\s*([A-Z]{2})\s*$/i);
        if (m) code = m[1].toUpperCase();
      }
      if (code && stats[code]) stats[code].alerts++;
    }
    return stats;
  },
  ["state-index-stats"],
  { revalidate: 600, tags: ["state-index-stats"] },
);

export default async function StatesIndexPage() {
  const stats = await getStateStats();

  // Sort: hot states (have any signals) first, alphabetic within
  const codes = Object.keys(STATE_NAMES);
  const hot = codes.filter((c) => stats[c].bills + stats[c].meetings + stats[c].alerts > 0).sort();
  const cool = codes.filter((c) => stats[c].bills + stats[c].meetings + stats[c].alerts === 0).sort();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📍 State directory
        </p>
        <h1 className="mt-2 text-3xl font-bold">Kratom policy by state</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every state has its own page aggregating active bills, upcoming
          hearings, recent alerts, and current campaigns. Quick links to
          state calendar, pulse feed, and call targets.
        </p>
      </header>

      {hot.length > 0 && (
        <Reveal as="section" className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
            Active right now · {hot.length} state{hot.length === 1 ? "" : "s"}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hot.map((code) => {
              const s = stats[code];
              const hotness = s.bills + s.meetings + s.alerts;
              return (
                <Link
                  key={code}
                  href={`/states/${code}`}
                  className="ik-lift block rounded-xl border border-emerald-700/30 bg-emerald-950/10 p-3 hover:border-emerald-500"
                >
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-lg font-bold text-zinc-100">{code}</p>
                    <span className="text-[10px] text-emerald-400">{hotness} signal{hotness === 1 ? "" : "s"}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{STATE_NAMES[code]}</p>
                  <ul className="mt-2 flex flex-wrap gap-1 text-[10px]">
                    {s.bills > 0 && <li className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">📜 {s.bills}</li>}
                    {s.meetings > 0 && <li className="rounded bg-amber-950/40 px-1.5 py-0.5 font-mono text-amber-300">📅 {s.meetings}</li>}
                    {s.alerts > 0 && <li className="rounded bg-red-950/40 px-1.5 py-0.5 font-mono text-red-300">🚨 {s.alerts}</li>}
                  </ul>
                </Link>
              );
            })}
          </div>
        </Reveal>
      )}

      {cool.length > 0 && (
        <Reveal as="section">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Quiet right now · {cool.length} state{cool.length === 1 ? "" : "s"}
          </h2>
          <div className="grid gap-1 sm:grid-cols-3 lg:grid-cols-5">
            {cool.map((code) => (
              <Link
                key={code}
                href={`/states/${code}`}
                className="ik-lift block rounded-lg border border-zinc-800 bg-zinc-950/40 p-2 hover:border-zinc-600"
              >
                <p className="font-mono text-sm font-bold text-zinc-300">{code}</p>
                <p className="text-[10px] text-zinc-600">{STATE_NAMES[code]}</p>
              </Link>
            ))}
          </div>
        </Reveal>
      )}
    </div>
  );
}
