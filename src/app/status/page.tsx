import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "iKratom · live platform status",
  description: "Real-time platform health: bills tracked, meetings monitored, alerts pushed, research catalogued. Proof the intel network is alive.",
};
export const dynamic = "force-dynamic";

/**
 * /status — public proof-of-life page.
 *
 * Live counts pulled from the database at request time:
 *   - Total active bills across all 50 states
 *   - Approved upcoming municipal meetings
 *   - Recent policy alerts pushed
 *   - Research papers indexed + AI-evaluated
 *   - Calls tracked by advocates
 *   - States with at least one signal (live nodes)
 *
 * Plus a per-source freshness table (sync_news_rss, classify-news-policy,
 * push-critical-alerts, fire-meeting-reminders, etc.) so anyone can see
 * the pipelines are running on schedule.
 *
 * Public — anyone can hit this URL to verify the intel network is real.
 * Demonstrates depth without exposing any user PII.
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

export default async function StatusPage() {
  const supabase = await createClient();
  const now = Date.now();
  const horizon90d = new Date(now + 90 * 86_400_000).toISOString();
  const since7d = new Date(now - 7 * 86_400_000).toISOString();
  const since30d = new Date(now - 30 * 86_400_000).toISOString();

  // Parallel pulls for the headline counts
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
  ] = await Promise.all([
    supabase.from("bills").select("state", { count: "exact" })
      .eq("active", true).in("kratom_relevance", ["anti", "pro"]),
    supabase.from("municipal_meetings").select("state", { count: "exact" })
      .eq("moderation_status", "approved")
      .gte("meeting_at", new Date(now).toISOString())
      .lte("meeting_at", horizon90d),
    supabase.from("policy_alerts").select("*", { count: "exact", head: true })
      .eq("moderation_status", "approved")
      .in("severity", ["critical", "alert"])
      .gte("created_at", since7d),
    supabase.from("research_papers").select("*", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("research_papers").select("*", { count: "exact", head: true })
      .eq("is_active", true).not("ai_evaluated_at", "is", null),
    supabase.from("call_sessions").select("*", { count: "exact", head: true })
      .gte("started_at", since30d).not("ended_at", "is", null),
    supabase.from("profiles").select("*", { count: "exact", head: true }),
    supabase.from("bills").select("state").eq("active", true).in("kratom_relevance", ["anti", "pro"]),
    supabase.from("municipal_meetings").select("state").eq("moderation_status", "approved")
      .gte("meeting_at", new Date(now).toISOString()).lte("meeting_at", horizon90d),
    supabase.from("legislator_kratom_stance").select("legislators!inner(state)").limit(20000),
    supabase.from("scraper_runs_latest").select("source, started_at, status, rows_added"),
  ]);

  // Speed-to-action metric: median minutes between alert publish-time
  // (occurs_at OR underlying news published_at OR created_at) and
  // first user campaign_action timestamp on that alert. The lobbyist-
  // equalizer measurement. Lower = better.
  // Sample: last 30 days of alerts that had at least one downstream action.
  let speedMedianMin: number | null = null;
  let speedSample = 0;
  try {
    // Step 1: pull recently-created alerts with their campaign_id
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
      // Step 2: pull first action per campaign
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
      // Step 3: per alert, compute minutes from event-time to first action
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

  // State coverage breakdown
  const stateActivityRaw = new Set<string>();
  for (const row of statesWithBills.data ?? []) {
    if (row.state) stateActivityRaw.add(row.state.toUpperCase());
  }
  for (const row of statesWithMeetings.data ?? []) {
    if (row.state) stateActivityRaw.add(row.state.toUpperCase());
  }
  const liveStates = stateActivityRaw.size;

  const stanceStates = new Set<string>();
  type StanceRow = { legislators: { state: string } | Array<{ state: string }> };
  for (const r of (statesWithStance.data ?? []) as StanceRow[]) {
    const leg = Array.isArray(r.legislators) ? r.legislators[0] : r.legislators;
    if (leg?.state) stanceStates.add(leg.state.toUpperCase());
  }

  // Build the cron-health table
  const cronByName = new Map<string, { started_at: string; status: string; rows_added: number | null }>();
  for (const r of cronRuns.data ?? []) {
    cronByName.set(r.source, {
      started_at: r.started_at,
      status: r.status,
      rows_added: r.rows_added,
    });
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
          Real-time platform snapshot pulled from the database at the moment
          you loaded this page. Updated every refresh. Designed as proof:
          when iKratom says &ldquo;we&apos;re tracking N bills across X states&rdquo;
          there&apos;s a number behind it.
        </p>
        <p className="mt-2 text-[10px] font-mono text-zinc-600">
          generated {new Date(now).toISOString().slice(0, 19).replace("T", " ")} UTC
        </p>
      </header>

      {/* Headline counts */}
      <section className="mb-10 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Active bills tracked"
          value={bills.count ?? 0}
          sub={`across ${stateActivityRaw.size} state${stateActivityRaw.size === 1 ? "" : "s"}`}
          tone="emerald"
        />
        <Stat
          label="Upcoming public meetings"
          value={meetings.count ?? 0}
          sub="next 90 days · approved + scheduled"
        />
        <Stat
          label="Alerts in last 7 days"
          value={alerts.count ?? 0}
          sub="critical + alert severity, approved"
        />
        <Stat
          label="Research papers"
          value={research.count ?? 0}
          sub={`${researchEvaluated.count ?? 0} AI-evaluated`}
        />
        <Stat
          label="Calls placed"
          value={callsLast30d.count ?? 0}
          sub="completed sessions, last 30d"
        />
        <Stat
          label="Registered advocates"
          value={advocates.count ?? 0}
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
          <PillarStat label="States with active bills" value={new Set((statesWithBills.data ?? []).map((r) => r.state?.toUpperCase()).filter(Boolean)).size} total={51} />
          <PillarStat label="States with upcoming meetings" value={new Set((statesWithMeetings.data ?? []).map((r) => r.state?.toUpperCase()).filter(Boolean)).size} total={51} />
          <PillarStat label="States with stance drafts" value={stanceStates.size} total={51} />
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          {liveStates} of 51 states + DC currently show real activity in our intel feeds.
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
