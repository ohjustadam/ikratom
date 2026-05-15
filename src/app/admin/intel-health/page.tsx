import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Intel Health" };
export const dynamic = "force-dynamic";

/**
 * /admin/intel-health — observability for the news → alert → campaign
 * pipeline. Surfaces:
 *
 *   1. Per-source freshness (last successful scrape, current status)
 *      Color-coded: green = fresh, amber = stale, red = silent
 *   2. Recent failures (last 25) with error message
 *   3. Pipeline counts (bills, news_items, alerts, campaigns) so the
 *      operator can sanity-check that the cron is producing volume
 *   4. Anything in moderation backlog (intel tips awaiting admin action)
 *
 * Phase 5 of the newsroom roadmap. Closes the "we don't know when a
 * source breaks until 9 days later" gap that bit us with NH SB 557.
 */
export default async function IntelHealthPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Per-source latest run (uses the convenience view from migration 0062)
  const { data: latestRows } = await supabase
    .from("scraper_runs_latest")
    .select("source, started_at, finished_at, status, rows_added, rows_updated, error_message");

  // Recent failures across all sources
  const { data: failures } = await supabase
    .from("scraper_runs")
    .select("source, started_at, status, error_message")
    .eq("status", "error")
    .order("started_at", { ascending: false })
    .limit(25);

  // Volume counts to sanity-check the pipeline
  const [billsTotal, billsThisWeek, newsTotal, newsThisWeek, alertsTotal, alertsPendingMod, campaignsAuto, intelTips] = await Promise.all([
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("bills").select("id", { count: "exact", head: true }).eq("active", true).gte("created_at", weekAgo),
    supabase.from("news_items").select("id", { count: "exact", head: true }),
    supabase.from("news_items").select("id", { count: "exact", head: true }).gte("scraped_at", weekAgo),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true }).eq("moderation_status", "approved"),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true }).eq("moderation_status", "pending"),
    supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("auto_generated", true).gte("created_at", weekAgo),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true }).eq("kind", "intel_tip"),
  ]);

  // Bills with no journey enrichment yet (visible quality signal)
  const { count: billsNoJourney } = await supabase
    .from("bills")
    .select("id", { count: "exact", head: true })
    .eq("active", true)
    .eq("scope", "state")
    .is("journey_analyzed_at", null);

  // News classified
  const { count: newsClassified } = await supabase
    .from("news_items")
    .select("id", { count: "exact", head: true })
    .not("policy_classified_at", "is", null);

  // Editorial freshness — owner directive 2026-05-14 to surface staleness
  // of editorial content (briefings, sync discrepancies, etc.) so the admin
  // can quickly see what's drifting without clicking into each subpage.
  const sixtyDaysAgo = new Date(now - 60 * 86_400_000).toISOString();
  const [
    { count: briefingsTotal },
    { count: briefingsStale },
    { count: openDiscrepancies },
    { count: pendingCampaigns },
    { count: pendingIntelTips },
    { count: localFightsOpen },
    { count: takebackBacklog },
  ] = await Promise.all([
    supabase.from("state_briefings").select("state", { count: "exact", head: true }),
    supabase.from("state_briefings").select("state", { count: "exact", head: true })
      .or(`published_at.is.null,published_at.lt.${sixtyDaysAgo}`),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true })
      .eq("kind", "scraper_stale").eq("moderation_status", "approved"),
    supabase.from("campaigns").select("id", { count: "exact", head: true })
      .eq("review_state", "pending_review"),
    supabase.from("policy_alerts").select("id", { count: "exact", head: true })
      .eq("kind", "intel_tip").eq("moderation_status", "pending"),
    supabase.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).eq("kratom_relevance", "anti")
      .in("scope", ["county", "municipal"])
      .in("status", ["introduced", "committee"]),
    // Editorial backlog: state-scope enacted-or-imminent anti-kratom bills
    // that DON'T yet have takeback intel curated. These are the rows
    // that /banned currently filters OUT (because opposition_summary_md
    // is the trust signal for "actual full ban") — but they may need
    // human review to confirm whether to write takeback content for them.
    supabase.from("bills").select("id", { count: "exact", head: true })
      .eq("active", true).eq("kratom_relevance", "anti").eq("scope", "state")
      .in("status", ["enacted", "passed_chamber"])
      .is("opposition_summary_md", null),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Intel Health</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Live status of every scraper + AI step in the news → alert → campaign
            pipeline. Refresh the page (or wait an hour for the next cron tick) to update.
          </p>
        </div>
        <span className="font-mono text-xs text-zinc-600">
          checked {new Date().toISOString().slice(0, 19).replace("T", " ")} UTC
        </span>
      </header>

      {/* Sub-page links */}
      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        <a
          href="/admin/intel-health/false-positives"
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
        >
          🛡️ News FP review
        </a>
        <a
          href="/admin/intel-health/states"
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
        >
          🗺️ Per-state coverage
        </a>
        <a
          href="/admin/stance/coverage"
          className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-zinc-300 hover:border-emerald-500 hover:text-emerald-400"
        >
          🎯 Stance coverage matrix
        </a>
      </nav>

      {/* Top-line counters */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Active bills" value={billsTotal.count ?? 0} sub={`+${billsThisWeek.count ?? 0} this week`} />
        <Stat label="News items ingested" value={newsTotal.count ?? 0} sub={`+${newsThisWeek.count ?? 0} this week`} />
        <Stat label="News classified" value={newsClassified ?? 0} sub={`${newsTotal.count ? Math.round(((newsClassified ?? 0) / newsTotal.count) * 100) : 0}% of total`} />
        <Stat label="Approved alerts" value={alertsTotal.count ?? 0} sub={`+${alertsPendingMod.count ?? 0} pending mod`} />
        <Stat label="Auto-campaigns this week" value={campaignsAuto.count ?? 0} sub="from policy_alerts" />
        <Stat label="Intel tips (lifetime)" value={intelTips.count ?? 0} sub="advocate-submitted" />
        <Stat label="Bills missing journey" value={billsNoJourney ?? 0} sub="needs enrich-bills:journey" tone={(billsNoJourney ?? 0) > 5 ? "warn" : "ok"} />
      </section>

      {/* Queue + freshness watch — added 2026-05-15 per owner directive.
          Surfaces what's drifting without requiring a click into each
          sub-page. Each row also links to the corresponding admin queue. */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Queue + freshness watch
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <QueueRow
            href="/admin/campaigns/pending"
            label="Campaigns pending review"
            count={pendingCampaigns ?? 0}
            note="Auto-generated campaigns awaiting human approval"
            warnAt={5}
          />
          <QueueRow
            href="/admin/sync-discrepancies"
            label="Sync discrepancies open"
            count={openDiscrepancies ?? 0}
            note="Bills where AI fact-check disagrees with DB (post auto-resolver)"
            warnAt={10}
          />
          <QueueRow
            href="/admin/intel-queue"
            label="Intel tips awaiting review"
            count={pendingIntelTips ?? 0}
            note="Advocate-submitted local intel from /alerts/submit"
            warnAt={3}
          />
          <QueueRow
            href="/bills?filter=local-active"
            label="Active local fights"
            count={localFightsOpen ?? 0}
            note="County + municipal anti-kratom bills in committee or introduced"
            warnAt={null}
          />
          <QueueRow
            href="/briefings"
            label="State briefings stale (60d+)"
            count={briefingsStale ?? 0}
            note={`${briefingsTotal ?? 0} total briefings indexed`}
            warnAt={5}
          />
          <QueueRow
            href="/admin/bills?status=enacted&relevance=anti&scope=state&takeback=missing"
            label="Takeback intel editorial backlog"
            count={takebackBacklog ?? 0}
            note="State-scope enacted/imminent anti-kratom bills missing opposition_summary_md (won't show on /banned until curated)"
            warnAt={5}
          />
          <QueueRow
            href="/admin/stance/coverage"
            label="Stance coverage matrix"
            count={null}
            note="Click to see per-state legislator stance fill rate"
            warnAt={null}
          />
        </div>
      </section>

      {/* Per-source freshness */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Source freshness
        </h2>
        {(latestRows ?? []).length === 0 ? (
          <p className="rounded-md border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-300">
            No scraper runs logged yet. The scraper_runs table is wired but the
            sync scripts don&apos;t write to it yet — that&apos;s a follow-up wiring task.
            Until then, this section shows nothing useful but the rest of the page works.
          </p>
        ) : (
          <ul className="space-y-1">
            {(latestRows ?? []).map((r) => {
              const startedMs = r.started_at ? new Date(r.started_at).getTime() : 0;
              const ageHours = (now - startedMs) / 3_600_000;
              const tone =
                r.status === "error" ? "bad" :
                ageHours < 2 ? "ok" :
                ageHours < 6 ? "watch" :
                ageHours < 24 ? "warn" : "bad";
              const dotCls =
                tone === "ok" ? "bg-emerald-400" :
                tone === "watch" ? "bg-emerald-600" :
                tone === "warn" ? "bg-amber-400" : "bg-red-500 animate-pulse";
              return (
                <li
                  key={r.source}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2"
                >
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotCls}`} />
                  <span className="font-mono text-sm text-zinc-200 min-w-[200px]">{r.source}</span>
                  <span className="text-xs text-zinc-500">
                    last {r.status} ·{" "}
                    {ageHours < 1
                      ? `${Math.round(ageHours * 60)} min ago`
                      : ageHours < 48
                      ? `${Math.round(ageHours)} h ago`
                      : `${Math.round(ageHours / 24)} d ago`}
                  </span>
                  {(r.rows_added != null || r.rows_updated != null) && (
                    <span className="font-mono text-xs text-zinc-500">
                      +{r.rows_added ?? 0} / ✎{r.rows_updated ?? 0}
                    </span>
                  )}
                  {r.error_message && (
                    <span className="ml-auto truncate text-[11px] text-red-400">
                      {r.error_message.slice(0, 120)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recent failures */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Recent failures (last 25)
        </h2>
        {(failures ?? []).length === 0 ? (
          <p className="rounded-md border border-emerald-700/40 bg-emerald-950/20 p-4 text-sm text-emerald-300">
            ✓ No failures logged. Pipeline is healthy.
          </p>
        ) : (
          <ul className="space-y-1">
            {(failures ?? []).map((f, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center gap-3 rounded-md border border-red-900/40 bg-red-950/10 px-3 py-2 text-xs"
              >
                <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-red-500" />
                <span className="font-mono text-zinc-300 min-w-[180px]">{f.source}</span>
                <span className="text-zinc-500 min-w-[140px]">
                  {f.started_at ? new Date(f.started_at).toLocaleString() : ""}
                </span>
                {f.error_message && (
                  <span className="truncate text-red-300">{f.error_message.slice(0, 200)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Pipeline guidance */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
          Pipeline architecture
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          Hourly cron via GitHub Actions runs:
        </p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 text-xs text-zinc-400">
          <li><code className="text-zinc-300">sync-news-rss</code> — Google News RSS across 50 states + DC + FED</li>
          <li><code className="text-zinc-300">classify-news-policy</code> — AI router classifies up to 200 unclassified news items per run</li>
          <li><code className="text-zinc-300">auto-campaign-from-alert</code> — generates solidarity campaigns for actionable alerts</li>
          <li><code className="text-zinc-300">promote-alert-to-bill</code> — wraps "City, ST" alerts as municipal bills</li>
          <li><code className="text-zinc-300">extract-local-meta</code> — AI parses alert body into structured event data</li>
          <li><code className="text-zinc-300">seed-bill-officials</code> — Gemini grounding pulls full city council slate</li>
          <li><code className="text-zinc-300">fanout-bill-reminders</code> — meeting reminders + status-change notifications to subscribers</li>
        </ol>
        <p className="mt-3 text-xs text-zinc-500">
          Run history: <a href="https://github.com/ohjustadam/ikratom/actions/workflows/cron-hourly.yml" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">GitHub Actions ↗</a>
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "ok",
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const valueColor =
    tone === "warn" ? "text-amber-300" : tone === "bad" ? "text-red-300" : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${valueColor}`}>
        {value.toLocaleString()}
      </div>
      {sub && <div className="text-[10px] text-zinc-600">{sub}</div>}
    </div>
  );
}

function QueueRow({
  href, label, count, note, warnAt,
}: {
  href: string;
  label: string;
  count: number | null;
  note: string;
  warnAt: number | null;
}) {
  const tone = count == null
    ? "neutral"
    : warnAt == null
    ? "neutral"
    : count > warnAt ? "amber" : count > 0 ? "emerald" : "neutral";
  const cls =
    tone === "amber"   ? "border-amber-700/50 bg-amber-950/15 hover:border-amber-400" :
    tone === "emerald" ? "border-emerald-700/40 bg-emerald-950/15 hover:border-emerald-400" :
                         "border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  const valCls =
    tone === "amber"   ? "text-amber-200" :
    tone === "emerald" ? "text-emerald-200" :
                         "text-zinc-300";
  return (
    <a href={href} className={`flex items-center gap-4 rounded-md border p-3 ${cls}`}>
      <div className={`min-w-[60px] text-right font-mono text-2xl font-bold tabular-nums ${valCls}`}>
        {count == null ? "—" : count.toLocaleString()}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-zinc-100">{label}</p>
        <p className="text-[11px] text-zinc-500">{note}</p>
      </div>
      <span className="text-xs text-zinc-500">→</span>
    </a>
  );
}
