import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Per-state Intel Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/intel-health/states — per-state grid showing intel coverage.
 *
 * For each of the 50 states + DC, surface:
 *   - active bill count
 *   - upcoming approved municipal_meetings count
 *   - approved policy_alerts count (last 30d)
 *   - user count (advocates registered with that state)
 *   - briefing freshness
 *
 * Goal: spot coverage gaps. A state with 0 users + 0 alerts + 0
 * meetings is a recruitment + intel-gathering opportunity. A state
 * with high alerts + low users is a target for outreach.
 *
 * Color-coded:
 *   - green: ≥3 users + active intel
 *   - amber: 1-2 users OR thin intel
 *   - red: no users + no intel = blind spot
 */
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

type StateStat = {
  state: string;
  users: number;
  active_bills: number;
  upcoming_meetings: number;
  alerts_30d: number;
  briefing_published_at: string | null;
};

export default async function PerStateIntelHealthPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 86_400_000);
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString();

  // Pull aggregates per state. We do these as 4 separate queries
  // and merge in JS — each is bounded by state and is fast.
  const [users, bills, meetings, alerts, briefings] = await Promise.all([
    supabase.from("profiles").select("state").not("state", "is", null),
    supabase.from("bills").select("state").eq("active", true),
    supabase.from("municipal_meetings")
      .select("state, meeting_at")
      .eq("moderation_status", "approved")
      .gte("meeting_at", now.toISOString())
      .lte("meeting_at", horizon.toISOString()),
    supabase.from("policy_alerts")
      .select("locality")
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert", "watch"])
      .gte("created_at", since30d),
    supabase.from("state_briefings")
      .select("state, published_at"),
  ]);

  // Aggregate
  const stats: Record<string, StateStat> = {};
  for (const code of Object.keys(STATE_NAMES)) {
    stats[code] = { state: code, users: 0, active_bills: 0, upcoming_meetings: 0, alerts_30d: 0, briefing_published_at: null };
  }

  for (const r of users.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].users++;
  }
  for (const r of bills.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].active_bills++;
  }
  for (const r of meetings.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].upcoming_meetings++;
  }
  for (const r of alerts.data ?? []) {
    // locality can be "NY" or "Marshall, IL"
    const loc = r.locality?.trim() ?? "";
    let code: string | null = null;
    if (/^[A-Z]{2}$/.test(loc)) code = loc;
    else {
      const m = loc.match(/,\s*([A-Z]{2})\s*$/i);
      if (m) code = m[1].toUpperCase();
    }
    if (code && stats[code]) stats[code].alerts_30d++;
  }
  for (const r of briefings.data ?? []) {
    const s = r.state?.toUpperCase();
    if (s && stats[s]) stats[s].briefing_published_at = r.published_at;
  }

  // Sort by activity total descending
  const sorted = Object.values(stats).sort((a, b) =>
    (b.users + b.active_bills + b.upcoming_meetings + b.alerts_30d) -
    (a.users + a.active_bills + a.upcoming_meetings + a.alerts_30d)
  );

  // Coverage tier
  function tierOf(s: StateStat): { tier: "high" | "mid" | "low"; tone: string } {
    const intel = s.active_bills + s.upcoming_meetings + s.alerts_30d;
    if (s.users >= 3 && intel >= 1) return { tier: "high", tone: "border-emerald-700/40 bg-emerald-950/15" };
    if (s.users >= 1 || intel >= 1) return { tier: "mid", tone: "border-amber-700/30 bg-amber-950/10" };
    return { tier: "low", tone: "border-red-700/30 bg-red-950/10" };
  }

  const totals = sorted.reduce(
    (acc, s) => ({
      users: acc.users + s.users,
      bills: acc.bills + s.active_bills,
      meetings: acc.meetings + s.upcoming_meetings,
      alerts: acc.alerts + s.alerts_30d,
    }),
    { users: 0, bills: 0, meetings: 0, alerts: 0 },
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </Link>

      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Per-state intel health</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Coverage grid for all 50 states + DC. Spot blind spots (no users
          + no intel = red) and outreach opportunities (high alerts + low
          users = amber).
        </p>
      </header>

      {/* Top-line totals */}
      <section className="mb-6 grid grid-cols-4 gap-3">
        <Stat label="Total advocates" value={totals.users} />
        <Stat label="Active bills" value={totals.bills} />
        <Stat label="Upcoming meetings" value={totals.meetings} />
        <Stat label="Alerts (30d)" value={totals.alerts} />
      </section>

      {/* Per-state grid */}
      <section>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => {
            const { tier, tone } = tierOf(s);
            const briefingAge = s.briefing_published_at
              ? Math.floor((Date.now() - new Date(s.briefing_published_at).getTime()) / 86_400_000)
              : null;
            return (
              <div key={s.state} className={`rounded-md border p-3 ${tone}`}>
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-lg font-bold text-zinc-100">{s.state}</p>
                  <span className={`text-[10px] font-bold uppercase ${
                    tier === "high" ? "text-emerald-300" :
                    tier === "mid" ? "text-amber-300" : "text-red-300"
                  }`}>
                    {tier === "high" ? "covered" : tier === "mid" ? "partial" : "blind"}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500">{STATE_NAMES[s.state]}</p>
                <ul className="mt-2 space-y-0.5 text-[11px] text-zinc-300">
                  <li className="flex justify-between"><span>👥 Advocates</span><span className="font-mono">{s.users}</span></li>
                  <li className="flex justify-between"><span>📜 Bills</span><span className="font-mono">{s.active_bills}</span></li>
                  <li className="flex justify-between"><span>📅 Meetings</span><span className="font-mono">{s.upcoming_meetings}</span></li>
                  <li className="flex justify-between"><span>🚨 Alerts (30d)</span><span className="font-mono">{s.alerts_30d}</span></li>
                </ul>
                <div className="mt-2 flex items-center justify-between text-[10px]">
                  <span className="text-zinc-600">
                    {briefingAge !== null
                      ? `briefing ${briefingAge}d old`
                      : <span className="text-red-400">no briefing</span>}
                  </span>
                  <Link href={`/briefings/state/${s.state}`} className="text-emerald-400 hover:underline">
                    view →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="mt-8 text-[10px] text-zinc-600">
        Generated {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC. Refresh page for latest.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</p>
    </div>
  );
}
