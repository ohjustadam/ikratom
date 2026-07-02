import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const metadata = {
  title: "iKratom · live platform status",
  description: "Real-time platform health: bills tracked, meetings monitored, alerts pushed, research catalogued. Proof the intel network is alive.",
};
// Kept dynamic so Next never tries to prerender this at build time (the
// data is live), but the actual DB work is wrapped in unstable_cache below
// (revalidate 300s). Before that, this force-dynamic page re-ran ~15 DB
// queries — including a 20k-row pull — on EVERY hit, which made it a
// self-serve OOM trigger on the free-tier (~400MB) instance (2026-06-08
// outage). Now any volume of traffic costs at most one snapshot per 5 min.
export const dynamic = "force-dynamic";

/**
 * /status — public proof-of-life page.
 *
 * Live counts pulled from the database (snapshotted every 5 min):
 *   - Total active bills across all 50 states
 *   - Approved upcoming municipal meetings
 *   - Recent policy alerts pushed
 *   - Research papers indexed + AI-evaluated
 *   - Calls tracked by advocates
 *   - States with at least one signal (live nodes)
 *
 * Plus a per-source freshness table so anyone can see the pipelines are
 * running on schedule.
 *
 * Public — anyone can hit this URL to verify the intel network is real.
 * Reads run through a service-role client (cookie-free, so the result is
 * cacheable) and only ever expose aggregate counts — never any user PII.
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
void STATE_NAMES;

// Cron jobs we expose publicly — the user-facing pipelines that
// matter to "is the data real?". Anything admin-only or PII-sensitive
// is filtered out by the explicit allowlist below.
const PUBLIC_PIPELINES = [
  { source: "sync_news_rss",                label: "News scrape",                  expectedHours: 1.5 },
  { source: "classify_news_policy",         label: "News classification (AI)",     expectedHours: 1.5 },
  { source: "push_critical_alerts",         label: "Push critical alerts",         expectedHours: 1.5 },
  { source: "push_state_news",              label: "Push state news",              expectedHours: 1.5 },
  { source: "push_bill_actions_to_actors",  label: "Push bill action updates",     expectedHours: 1.5 },
  { source: "sync_bills_legiscan_priority", label: "LegiScan bill sync",           expectedHours: 1.5 },
  { source: "fire_meeting_reminders",       label: "Meeting reminders (7d/3d/1d)", expectedHours: 26 },
  { source: "discover_municipal_meetings",  label: "Discover city/county meetings",expectedHours: 26 },
  { source: "scan_granicus_tenants",        label: "Granicus tenant scan",         expectedHours: 26 },
  { source: "scan_legistar_tenants",        label: "Legistar tenant scan",         expectedHours: 26 },
  { source: "generate_state_briefing",      label: "State briefings (AI)",         expectedHours: 26 },
  { source: "sync_research_pubmed",         label: "PubMed research sync",         expectedHours: 26 },
  { source: "sync_committees_openstates",   label: "Legislator committees",        expectedHours: 26 },
  { source: "draft_legislator_stance",      label: "Stance drafts (AI)",           expectedHours: 26 },
  { source: "auto_resolve_sync_discrepancies", label: "Auto-resolve discrepancies", expectedHours: 26 },
  { source: "verify_bill_status_ai",        label: "Bill status verify (AI)",      expectedHours: 26 },
];

type StatusSnapshot = {
  billsCount: number;
  meetingsCount: number;
  alertsCount: number;
  researchCount: number;
  researchEvaluatedCount: number;
  callsCount: number;
  advocatesCount: number;
  statesWithBillsCount: number;
  statesWithMeetingsCount: number;
  stanceStatesCount: number;
  liveStates: number;
  billsInCommitteeCount: number;
  antiBillsInCommitteeCount: number;
  cronRuns: { source: string; started_at: string; status: string; rows_added: number | null }[];
  speedMedianMin: number | null;
  speedSample: number;
  generatedAt: string;
};

/**
 * All the DB work for /status, snapshotted across requests (revalidate 5m).
 * Uses a service-role client so it's cookie-free (cacheable) — only aggregate
 * counts leave this function, never user rows.
 */
const getStatusSnapshot = unstable_cache(
  async (): Promise<StatusSnapshot> => {
    const supabase = createServiceRoleClient();
    const now = Date.now();
    const horizon90d = new Date(now + 90 * 86_400_000).toISOString();
    const since7d = new Date(now - 7 * 86_400_000).toISOString();
    const since30d = new Date(now - 30 * 86_400_000).toISOString();

    const [
      bills,
      meetings,
      alerts,
      research,
      researchEvaluated,
      callsLast30d,
      advocates,
      statesWithBills,
      statesWithMeetings,
      statesWithStance,
      cronRuns,
      billsInCommittee,
      antiBillsInCommittee,
    ] = await Promise.all([
      supabase.from("bills").select("state", { count: "exact", head: true })
        .eq("active", true).in("kratom_relevance", ["anti", "pro"]),
      supabase.from("municipal_meetings").select("state", { count: "exact", head: true })
        .eq("moderation_status", "approved")
        .gte("meeting_at", new Date(now).toISOString())
        .lte("meeting_at", horizon90d),
      supabase.from("policy_alerts").select("*", { count: "exact", head: true })
        .eq("moderation_status", "approved")
        .in("severity", ["critical", "alert"])
        .gte("created_at", since7d),
      // count by id (PK, granted col) — 0227 revoked anon SELECT on some
      // research_papers columns, so a `select("*")` count errors.
      supabase.from("research_papers").select("id", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("research_papers").select("id", { count: "exact", head: true })
        .eq("is_active", true).not("ai_evaluated_at", "is", null),
      supabase.from("call_sessions").select("*", { count: "exact", head: true })
        .gte("started_at", since30d).not("ended_at", "is", null),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      // Distinct-state coverage: pull just the `state` column (small) to
      // count distinct states with an active anti/pro bill.
      supabase.from("bills").select("state").eq("active", true).in("kratom_relevance", ["anti", "pro"]),
      supabase.from("municipal_meetings").select("state").eq("moderation_status", "approved")
        .gte("meeting_at", new Date(now).toISOString()).lte("meeting_at", horizon90d),
      // Distinct states with a stance draft. Capped at 2000 (was 20000):
      // there are only 51 possible states, so a 2000-row sample captures
      // them all in practice while keeping the payload bounded.
      supabase.from("legislator_stance").select("legislators!inner(state)").eq("topic", "kratom").limit(2000),
      supabase.from("scraper_runs_latest").select("source, started_at, status, rows_added"),
      supabase.from("bills").select("current_committee_name", { count: "exact", head: true })
        .eq("active", true)
        .not("current_committee_name", "is", null),
      supabase.from("bills").select("current_committee_name", { count: "exact", head: true })
        .eq("active", true)
        .eq("kratom_relevance", "anti")
        .not("current_committee_name", "is", null),
    ]);

    // Speed-to-action metric: median minutes from event detection to first
    // advocate action. Best-effort; never blocks the snapshot.
    let speedMedianMin: number | null = null;
    let speedSample = 0;
    try {
      const { data: recentAlerts } = await supabase
        .from("policy_alerts")
        .select("id, campaign_id, created_at, occurs_at")
        .not("campaign_id", "is", null)
        .gte("created_at", since30d)
        .limit(200);
      const campaignIds = (recentAlerts ?? [])
        .map((a) => a.campaign_id)
        .filter(Boolean) as string[];
      if (campaignIds.length > 0) {
        const { data: actions } = await supabase
          .from("campaign_actions")
          .select("campaign_id, sent_at")
          .in("campaign_id", campaignIds)
          .order("sent_at", { ascending: true });
        const firstActionByCampaign = new Map<string, string>();
        for (const a of (actions ?? []) as Array<{ campaign_id: string; sent_at: string }>) {
          if (!firstActionByCampaign.has(a.campaign_id)) {
            firstActionByCampaign.set(a.campaign_id, a.sent_at);
          }
        }
        const minutes: number[] = [];
        for (const a of recentAlerts ?? []) {
          if (!a.campaign_id) continue;
          const firstAction = firstActionByCampaign.get(a.campaign_id);
          if (!firstAction) continue;
          const eventTime = a.occurs_at ? new Date(a.occurs_at).getTime() : new Date(a.created_at).getTime();
          const actionTime = new Date(firstAction).getTime();
          if (actionTime <= eventTime) continue;
          minutes.push((actionTime - eventTime) / 60_000);
        }
        if (minutes.length > 0) {
          minutes.sort((a, b) => a - b);
          speedMedianMin = minutes[Math.floor(minutes.length / 2)];
          speedSample = minutes.length;
        }
      }
    } catch { /* metric is best-effort */ }

    // Distinct-state sets
    const billStates = new Set<string>();
    for (const row of statesWithBills.data ?? []) {
      if (row.state) billStates.add(row.state.toUpperCase());
    }
    const meetingStates = new Set<string>();
    for (const row of statesWithMeetings.data ?? []) {
      if (row.state) meetingStates.add(row.state.toUpperCase());
    }
    const liveStates = new Set<string>([...billStates, ...meetingStates]).size;

    const stanceStates = new Set<string>();
    type StanceRow = { legislators: { state: string } | Array<{ state: string }> };
    for (const r of (statesWithStance.data ?? []) as StanceRow[]) {
      const leg = Array.isArray(r.legislators) ? r.legislators[0] : r.legislators;
      if (leg?.state) stanceStates.add(leg.state.toUpperCase());
    }

    return {
      billsCount: bills.count ?? 0,
      meetingsCount: meetings.count ?? 0,
      alertsCount: alerts.count ?? 0,
      researchCount: research.count ?? 0,
      researchEvaluatedCount: researchEvaluated.count ?? 0,
      callsCount: callsLast30d.count ?? 0,
      advocatesCount: advocates.count ?? 0,
      statesWithBillsCount: billStates.size,
      statesWithMeetingsCount: meetingStates.size,
      stanceStatesCount: stanceStates.size,
      liveStates,
      billsInCommitteeCount: billsInCommittee.count ?? 0,
      antiBillsInCommitteeCount: antiBillsInCommittee.count ?? 0,
      cronRuns: (cronRuns.data ?? []).map((r) => ({
        source: r.source as string,
        started_at: r.started_at as string,
        status: r.status as string,
        rows_added: (r.rows_added ?? null) as number | null,
      })),
      speedMedianMin,
      speedSample,
      generatedAt: new Date(now).toISOString(),
    };
  },
  ["status-snapshot-v1"],
  { revalidate: 300, tags: ["status-snapshot"] },
);

export default async function StatusPage() {
  const snap = await getStatusSnapshot();
  const now = Date.now();

  // Build the cron-health table from the cached snapshot
  const cronByName = new Map<string, { started_at: string; status: string; rows_added: number | null }>();
  for (const r of snap.cronRuns) {
    cronByName.set(r.source, { started_at: r.started_at, status: r.status, rows_added: r.rows_added });
  }

  const pipelineStatus = PUBLIC_PIPELINES.map((p) => {
    const last = cronByName.get(p.source);
    if (!last) return { ...p, ageH: null, status: "never_ran", tone: "zinc" as const };
    const ageH = (now - new Date(last.started_at).getTime()) / 3_600_000;
    const stale = ageH > p.expectedHours * 1.5;
    const error = last.status === "error";
    const tone: "emerald" | "amber" | "red" = error ? "red" : stale ? "amber" : "emerald";
    return { ...p, ageH, last_status: last.status, last_rows: last.rows_added, tone, error };
  });

  const healthyPipelines = pipelineStatus.filter((p) => p.tone === "emerald").length;
  const allPipelines = pipelineStatus.length;

  const { speedMedianMin, speedSample } = snap;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Live status
        </p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
          The intel network is alive.
        </h1>
        <p className="mt-3 max-w-3xl text-base text-zinc-400">
          Platform snapshot pulled from the database, refreshed every few
          minutes. Designed as proof: when iKratom says &ldquo;we&apos;re
          tracking N bills across X states&rdquo; there&apos;s a number behind it.
        </p>
        <p className="mt-2 text-[10px] font-mono text-zinc-600">
          generated {snap.generatedAt.slice(0, 19).replace("T", " ")} UTC
        </p>
      </header>

      {/* Headline counts */}
      <section className="mb-10 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active bills tracked"
          value={snap.billsCount}
          sub={`across ${snap.liveStates} state${snap.liveStates === 1 ? "" : "s"}`}
          tone="emerald"
        />
        <Stat
          label="Upcoming public meetings"
          value={snap.meetingsCount}
          sub="next 90 days · approved + scheduled"
        />
        <Stat
          label="Alerts in last 7 days"
          value={snap.alertsCount}
          sub="critical + alert severity, approved"
        />
        <Stat
          label="Research papers"
          value={snap.researchCount}
          sub={`${snap.researchEvaluatedCount} AI-evaluated`}
        />
        <Stat
          label="Calls placed"
          value={snap.callsCount}
          sub="completed sessions, last 30d"
        />
        <Stat
          label="Registered advocates"
          value={snap.advocatesCount}
          sub="across all states"
        />
      </section>

      {/* Speed-to-action — the lobbyist-equalizer metric */}
      {speedMedianMin !== null && (
        <section className="mb-10 rounded-lg border border-amber-700/40 bg-amber-950/15 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
            ⚡ Speed-to-action — the lobbyist-equalizer
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            Median time from event detection to first advocate action sent.
            Lobbyists hit comment windows in minutes via paid subscriptions.
            This is our equivalent.
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-4">
            <span className="text-5xl font-bold tabular-nums text-amber-200">
              {speedMedianMin < 60
                ? `${Math.round(speedMedianMin)}m`
                : speedMedianMin < 1440
                ? `${(speedMedianMin / 60).toFixed(1)}h`
                : `${(speedMedianMin / 1440).toFixed(1)}d`}
            </span>
            <div>
              <p className="text-xs text-zinc-400">
                median over {speedSample} alert{speedSample === 1 ? "" : "s"} (last 30 days)
              </p>
              <p className="mt-1 text-[10px] text-zinc-500">
                Lobbyist comparable: typically 5-15 minutes via paid subscriptions
                ($5K-50K/year).
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Committee-leverage moments */}
      {snap.billsInCommitteeCount > 0 && (
        <section className="mb-10 rounded-lg border border-emerald-500/40 bg-emerald-950/15 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            ⚡ Committee leverage windows — open right now
          </h2>
          <p className="mt-2 text-sm text-zinc-300">
            Bills currently sitting in a parseable committee. Each one is a
            window where a small group of legislators decides the bill, and
            their constituents&apos; calls move it. Signed-in users see a
            personalized version on <a href="/bills?filter=in-my-committees" className="text-emerald-400 hover:underline">/bills?filter=in-my-committees</a>.
          </p>
          <div className="mt-4 flex flex-wrap items-baseline gap-6">
            <div>
              <span className="text-5xl font-bold tabular-nums text-emerald-200">
                {snap.billsInCommitteeCount}
              </span>
              <p className="mt-1 text-[11px] text-zinc-400">
                bills in committee with structured assignment
              </p>
            </div>
            {snap.antiBillsInCommitteeCount > 0 && (
              <div>
                <span className="text-3xl font-bold tabular-nums text-red-300">
                  {snap.antiBillsInCommitteeCount}
                </span>
                <p className="mt-1 text-[11px] text-zinc-400">
                  of those are anti-kratom — defense windows
                </p>
              </div>
            )}
          </div>
          <p className="mt-3 text-[10px] text-zinc-500">
            Lobbyists target committee members precisely. The platform now
            does the same cross-reference automatically for every signed-in
            user, on every bill page.
          </p>
        </section>
      )}

      {/* Three-pillar coverage */}
      <section className="mb-10 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
          🗺️ Three-pillar state coverage
        </h2>
        <p className="mt-2 text-sm text-zinc-300">
          A state is a &ldquo;live node&rdquo; when it has at least one of:
          tracked bill / scheduled public meeting / drafted legislator stance.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <PillarStat label="States with active bills" value={snap.statesWithBillsCount} total={51} />
          <PillarStat label="States with upcoming meetings" value={snap.statesWithMeetingsCount} total={51} />
          <PillarStat label="States with stance drafts" value={snap.stanceStatesCount} total={51} />
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          {snap.liveStates} of 51 states + DC currently show real activity in our intel feeds.
        </p>
      </section>

      {/* Pipeline freshness table */}
      <section className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            🔧 Pipeline health
          </h2>
          <span className="text-[11px] text-zinc-500">
            {healthyPipelines} of {allPipelines} pipelines healthy
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-2">Pipeline</th>
                <th className="px-3 py-2">Last run</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {pipelineStatus.map((p) => {
                const dot = p.tone === "emerald" ? "bg-emerald-500"
                  : p.tone === "amber" ? "bg-amber-400"
                  : p.tone === "red" ? "bg-red-500" : "bg-zinc-600";
                const ageLabel = p.ageH === null
                  ? "never"
                  : p.ageH < 1 ? `${Math.round(p.ageH * 60)}m ago`
                  : p.ageH < 24 ? `${p.ageH.toFixed(1)}h ago`
                  : `${(p.ageH / 24).toFixed(1)}d ago`;
                return (
                  <tr key={p.source}>
                    <td className="px-3 py-2 text-zinc-100">
                      <span className="font-medium">{p.label}</span>
                      <span className="ml-2 font-mono text-[10px] text-zinc-600">{p.source}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{ageLabel}</td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                        <span className="text-[11px] text-zinc-300">
                          {p.tone === "emerald" ? "healthy"
                            : p.tone === "amber" ? "stale"
                            : p.tone === "red" ? "errored"
                            : "n/a"}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-400">
                      {"last_rows" in p ? (p.last_rows ?? "—") : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Architecture link */}
      <section className="mb-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-300">How it works</p>
        <p className="mt-2 text-sm text-zinc-400">
          Every count above is a live database query. Every pipeline above is a
          GitHub Actions cron job that hits a public free API (Google News RSS,
          LegiScan, OpenStates, PubMed, etc.) and writes to Postgres. Anthropic
          Claude is used only for stakes-critical work; the workhorse models are
          free-tier Groq + Gemini + Cerebras + Mistral.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href="/pitch/efficiency" className="rounded bg-emerald-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400">
            See the full stack →
          </Link>
          <Link href="/pitch" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 hover:border-emerald-500">
            Architecture overview
          </Link>
          <Link href="/states" className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 hover:border-emerald-500">
            Browse by state
          </Link>
        </div>
      </section>

      <p className="text-[11px] text-zinc-600">
        Some pipelines (committee sync, stance drafter, weekly all-states catch-up) run on
        24h+ cadence by design. &ldquo;Stale&rdquo; means the last run was more than 1.5× the expected
        interval. Errors surface on /admin/intel-health for admin triage.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "zinc",
}: {
  label: string;
  value: number;
  sub: string;
  tone?: "zinc" | "emerald";
}) {
  const toneCls = tone === "emerald"
    ? "border-emerald-700/40 bg-emerald-950/15"
    : "border-zinc-800 bg-zinc-950/40";
  return (
    <div className={`rounded-lg border p-4 ${toneCls}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${tone === "emerald" ? "text-emerald-300" : "text-zinc-100"}`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-[10px] text-zinc-500">{sub}</p>
    </div>
  );
}

function PillarStat({ label, value, total }: { label: string; value: number; total: number }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const toneCls = pct >= 50
    ? "border-emerald-700/40"
    : pct >= 20 ? "border-amber-700/30" : "border-red-700/30";
  return (
    <div className={`rounded-md border ${toneCls} bg-zinc-950/40 p-3`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">
        {value}<span className="text-base font-normal text-zinc-500"> / {total}</span>
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-900">
        <div
          className={pct >= 50 ? "bg-emerald-500" : pct >= 20 ? "bg-amber-400" : "bg-red-500"}
          style={{ width: `${Math.min(100, pct)}%`, height: "100%" }}
        />
      </div>
    </div>
  );
}
