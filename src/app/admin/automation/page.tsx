import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Automation health" };
export const dynamic = "force-dynamic";

/**
 * /admin/automation — single pane of glass for every cron / scraper /
 * scheduled job the platform runs. Admin-only.
 *
 * The platform's "operating system" is a swarm of scheduled scripts —
 * Vercel crons (daily-sync, reverify-locals), GitHub Actions
 * workflows (cron-hourly, cron-daily, cron-weekly with ~40 jobs
 * across them), and a handful of Postgres triggers. When any of those
 * silently stop firing, intel goes stale and advocates miss real
 * activity. This dashboard surfaces the problem fast.
 *
 * Three columns:
 *   1. Cron system overview — Vercel + GH Actions + DB triggers, each
 *      with last-known status.
 *   2. Per-source freshness — every distinct `scraper_runs.source`
 *      with expected interval, last successful run, current state.
 *   3. Recent failures (last 50) — for quick diagnostics.
 *
 * Expected-interval metadata is baked in here (not the DB) because
 * the schedules live in YAML and JSON, not Postgres, and editing this
 * file is a code-review point that catches schedule drift.
 */

// Expected interval per source. Used to flag staleness on the
// freshness table. Conservative — we expect a 1h job to run at least
// every 4h after retries; a daily job every 36h; a weekly every 9d.
const EXPECTED: Record<string, { interval_hours: number; cadence: string; system: string }> = {
  // Hourly (GH Actions cron-hourly.yml)
  sync_news_rss:               { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  classify_news_policy:        { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  push_critical_alerts:        { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  push_state_news:             { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  push_bill_actions_to_actors: { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  auto_campaign_from_alert:    { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  promote_alert_to_bill:       { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  extract_local_meta:          { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  seed_bill_officials:         { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  auto_post_bills_to_forum:    { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  sync_bills_legiscan_priority:{ interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  post_bill_alerts_to_discord: { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  fan_out_bill_subscriptions:  { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  fire_custom_reminders:       { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  scrape_protectkratom_org:    { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  correlate_news_to_bills:     { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  resolve_news_urls:           { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  verify_news_body:            { interval_hours: 4,  cadence: "hourly", system: "GitHub Actions" },
  // Daily (GH Actions cron-daily.yml)
  sync_bill_sponsors:                { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  detect_bill_clusters:              { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  draft_legislator_stance:           { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_legislator_donors:            { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  classify_donor_industries:         { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_federal_trades:               { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_lda_kratom:                   { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  scrape_bop_findings:               { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  parse_bop_pdfs:                    { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  classify_bop_findings_ai:          { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_federal_awards:               { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_federal_rulemaking:           { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_courtlistener_cases:          { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  generate_state_briefing:           { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  audit_briefings_self_critique:     { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  intel_coverage_matrix:             { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  daily_data_quality:                { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_committees_openstates:        { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  discover_municipal_meetings:       { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  fire_meeting_reminders:            { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  scan_legistar_tenants:             { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  scan_granicus_tenants:             { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  sync_research_pubmed:              { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  ai_evaluate_papers:                { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  legiscan_full_sweep:               { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  openstates_vote_sync:              { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  backfill_current_committee:        { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  index_legislator_news_mentions:    { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  ai_correlate_news_to_bills:        { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  re_enrich_stale_bill_journeys:     { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  scrape_utah_lobbyist_registry:     { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  ai_grounded_status_verification:   { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  auto_resolve_sync_discrepancies:   { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  openfec_donor_sync:                { interval_hours: 36, cadence: "daily",  system: "GitHub Actions" },
  // Weekly (GH Actions cron-weekly.yml)
  sync_nonprofit_990s:               { interval_hours: 216, cadence: "weekly", system: "GitHub Actions" },
  broadcast_whats_new:               { interval_hours: 216, cadence: "weekly", system: "GitHub Actions" },
  weekly_committee_sync:             { interval_hours: 216, cadence: "weekly", system: "GitHub Actions" },
  weekly_patch_note_draft:           { interval_hours: 216, cadence: "weekly", system: "GitHub Actions" },
  weekly_digest_broadcast:           { interval_hours: 216, cadence: "weekly", system: "GitHub Actions" },
};

const CRON_SYSTEMS = [
  {
    name: "Vercel daily-sync",
    purpose: "News RSS + OpenStates bill sync across all 50 states + DC.",
    schedule: "Daily 12:00 UTC (~7am ET)",
    host: "Vercel Cron",
    indicator_source: "sync_news_rss", // closest tracked source
  },
  {
    name: "Vercel reverify-local-officials",
    purpose: "Re-check municipal-officials currency, flag stale rows.",
    schedule: "Weekly Sun 08:00 UTC",
    host: "Vercel Cron",
    indicator_source: null,
  },
  {
    name: "GH Actions cron-hourly",
    purpose: "News pipeline + alert classification + push fan-out + bill sync.",
    schedule: "Every hour + :30",
    host: "GitHub Actions",
    indicator_source: "sync_news_rss",
  },
  {
    name: "GH Actions cron-daily",
    purpose: "~40 daily-cadence jobs: stance drafts, donor sync, BoP, briefings.",
    schedule: "Daily 10:00 UTC",
    host: "GitHub Actions",
    indicator_source: "detect_bill_clusters",
  },
  {
    name: "GH Actions cron-weekly",
    purpose: "990 finances, weekly digest, committee re-sync, patch notes.",
    schedule: "Weekly Sun 02:00 UTC",
    host: "GitHub Actions",
    indicator_source: "sync_nonprofit_990s",
  },
  {
    name: "DB trigger: auto_campaign_from_alert",
    purpose: "Real-time: spawn solidarity campaign on actionable alert insert.",
    schedule: "On INSERT to policy_alerts",
    host: "Postgres trigger",
    indicator_source: null,
  },
];

type Run = {
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_added: number | null;
  rows_updated: number | null;
  error_message: string | null;
};

export default async function AutomationDashboard() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const sb = await createClient();
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();

  const [{ data: latestRows }, { data: failures }, { data: recentRunsAll }] = await Promise.all([
    sb.from("scraper_runs_latest")
      .select("source, started_at, finished_at, status, rows_added, rows_updated, error_message"),
    sb.from("scraper_runs")
      .select("source, started_at, status, error_message")
      .eq("status", "error")
      .order("started_at", { ascending: false })
      .limit(50),
    sb.from("scraper_runs")
      .select("source, finished_at, status")
      .gte("finished_at", since)
      .order("finished_at", { ascending: false }),
  ]);

  // Build per-source rollup: latest run + count of runs/failures in 30d
  const runCount = new Map<string, number>();
  const failCount = new Map<string, number>();
  for (const r of (recentRunsAll ?? []) as Array<{ source: string; status: string }>) {
    runCount.set(r.source, (runCount.get(r.source) || 0) + 1);
    if (r.status === "error" || r.status === "failed") {
      failCount.set(r.source, (failCount.get(r.source) || 0) + 1);
    }
  }

  // Sort sources by staleness (most stale first), unknown-expected at the bottom
  type Row = {
    source: string;
    last_at: string | null;
    status: string | null;
    hours_ago: number;
    expected_hours: number | null;
    cadence: string;
    system: string;
    fresh: "fresh" | "warn" | "stale" | "silent" | "unknown";
    runs30: number;
    fails30: number;
    rows_updated: number | null;
  };
  const now = Date.now();
  const rows: Row[] = (latestRows ?? []).map((r: Run) => {
    const meta = EXPECTED[r.source];
    const lastTs = r.finished_at ? new Date(r.finished_at).getTime() : NaN;
    const hours_ago = isFinite(lastTs) ? (now - lastTs) / 3600000 : Infinity;
    let fresh: Row["fresh"] = "unknown";
    if (meta) {
      if (hours_ago > meta.interval_hours * 3) fresh = "silent";
      else if (hours_ago > meta.interval_hours * 1.5) fresh = "stale";
      else if (hours_ago > meta.interval_hours) fresh = "warn";
      else fresh = "fresh";
    }
    return {
      source: r.source,
      last_at: r.finished_at,
      status: r.status,
      hours_ago: isFinite(hours_ago) ? hours_ago : 9999,
      expected_hours: meta?.interval_hours ?? null,
      cadence: meta?.cadence ?? "unknown",
      system: meta?.system ?? "untracked",
      fresh,
      runs30: runCount.get(r.source) ?? 0,
      fails30: failCount.get(r.source) ?? 0,
      rows_updated: r.rows_updated ?? r.rows_added ?? null,
    };
  });
  rows.sort((a, b) => {
    const order = (f: Row["fresh"]) => ({ silent: 0, stale: 1, warn: 2, unknown: 3, fresh: 4 }[f]);
    return order(a.fresh) - order(b.fresh) || b.hours_ago - a.hours_ago;
  });

  // Per-system aggregate health
  const systemHealth = new Map<string, { total: number; silent: number; stale: number }>();
  for (const r of rows) {
    const sys = r.system;
    const cur = systemHealth.get(sys) ?? { total: 0, silent: 0, stale: 0 };
    cur.total += 1;
    if (r.fresh === "silent") cur.silent += 1;
    if (r.fresh === "stale" || r.fresh === "warn") cur.stale += 1;
    systemHealth.set(sys, cur);
  }

  const silentCount = rows.filter((r) => r.fresh === "silent").length;
  const staleCount = rows.filter((r) => r.fresh === "stale" || r.fresh === "warn").length;
  const freshCount = rows.filter((r) => r.fresh === "fresh").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Automation health
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Daily automation dashboard</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          The platform&apos;s &quot;operating system&quot; — Vercel crons, GitHub Actions workflows, and Postgres
          triggers. When any silently stops firing, intel goes stale and advocates miss real activity.
          This is the single pane of glass.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          {freshCount} fresh · {staleCount} stale · <strong className="text-red-300">{silentCount} silent</strong>
        </p>
      </header>

      {/* Big-banner alert if anything is silent */}
      {silentCount > 0 && (
        <section className="mb-6 rounded-lg border-2 border-red-600/60 bg-red-950/25 p-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-red-300">
            🚨 {silentCount} source{silentCount === 1 ? "" : "s"} silent — went past 3× expected interval
          </p>
          <p className="mt-1 text-xs text-red-200/90">
            Most common root cause: GitHub Actions billing failure stops cron-hourly / cron-daily / cron-weekly entirely.
            Check{" "}
            <a href="https://github.com/settings/billing" target="_blank" rel="noopener noreferrer" className="underline">
              github.com/settings/billing
            </a>
            {" "}for payment issues, then re-run any failed workflow from the Actions tab.
          </p>
        </section>
      )}

      {/* Cron systems overview */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          Cron systems ({CRON_SYSTEMS.length})
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {CRON_SYSTEMS.map((sys) => {
            const indicator = sys.indicator_source ? rows.find((r) => r.source === sys.indicator_source) : null;
            const indicatorTone = indicator
              ? indicator.fresh === "silent"
                ? "border-red-700/60 bg-red-950/15"
                : indicator.fresh === "stale" || indicator.fresh === "warn"
                ? "border-amber-700/60 bg-amber-950/15"
                : "border-emerald-700/60 bg-emerald-950/15"
              : "border-zinc-800 bg-zinc-950/40";
            return (
              <li key={sys.name} className={`rounded-lg border p-3 text-[11px] ${indicatorTone}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-zinc-100">{sys.name}</span>
                  <span className="rounded bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-zinc-300">
                    {sys.host}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-400">{sys.purpose}</p>
                <p className="mt-1 font-mono text-[10px] text-zinc-500">{sys.schedule}</p>
                {indicator && (
                  <p className="mt-1 text-[10px] text-zinc-400">
                    Last <code className="bg-zinc-900 px-1">{sys.indicator_source}</code>:{" "}
                    <strong className={
                      indicator.fresh === "silent" ? "text-red-300"
                      : indicator.fresh === "stale" || indicator.fresh === "warn" ? "text-amber-300"
                      : "text-emerald-300"
                    }>
                      {indicator.hours_ago < 1 ? "minutes ago" : `${indicator.hours_ago.toFixed(1)}h ago`}
                    </strong>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Per-source freshness table */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          Per-source freshness ({rows.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="min-w-full text-[11px]">
            <thead className="bg-zinc-950 text-[10px] uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="border-b border-zinc-800 px-2 py-2 text-left">Source</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-left">System / cadence</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-right">Last run</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-right">Hours ago</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-right">Runs/30d</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-right">Fails/30d</th>
                <th className="border-b border-zinc-800 px-2 py-2 text-center">Health</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.source} className="border-b border-zinc-900 hover:bg-zinc-900/30">
                  <td className="px-2 py-1.5 font-mono text-zinc-200">{r.source}</td>
                  <td className="px-2 py-1.5 text-zinc-400">
                    {r.system} · <span className="text-[10px] uppercase">{r.cadence}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-zinc-500">
                    {r.last_at?.slice(0, 16) ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[10px] text-zinc-400">
                    {r.hours_ago === 9999 ? "—" : r.hours_ago.toFixed(1)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-zinc-400">{r.runs30}</td>
                  <td className={`px-2 py-1.5 text-right font-mono ${r.fails30 > 0 ? "text-red-300" : "text-zinc-500"}`}>
                    {r.fails30}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <HealthBadge fresh={r.fresh} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-6 text-center text-zinc-500">
                    No scraper_runs records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent failures */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-red-300">
          Recent failures ({failures?.length ?? 0})
        </h2>
        {(failures?.length ?? 0) === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
            No failures recorded. (Note: this only catches errors the scripts caught + logged. GitHub Actions billing failures or workflow-level errors don&apos;t hit this table.)
          </p>
        ) : (
          <ul className="space-y-1.5 text-[10px]">
            {(failures ?? []).map((f: { source: string; started_at: string; error_message: string | null }, i: number) => (
              <li key={i} className="rounded border border-red-700/30 bg-red-950/10 px-2 py-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono font-bold text-red-200">{f.source}</span>
                  <span className="text-zinc-500">{f.started_at?.slice(0, 16)}</span>
                </div>
                {f.error_message && (
                  <p className="mt-0.5 text-red-300/80">{f.error_message.slice(0, 240)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[10px] text-zinc-500">
        <p>
          <strong className="text-zinc-300">How to read this:</strong>{" "}
          Each source declares an expected cadence (interval). Past 1× → warn (amber). Past 1.5× → stale.
          Past 3× → silent (red). Sources not listed in the expected-interval map render as &quot;unknown&quot;.
          When a whole system goes silent at once (all GH-Actions sources together), the culprit is usually
          a workflow-level failure — billing, secrets, or runner outage.
        </p>
        <p className="mt-2">
          Related: <Link href="/admin/intel-health" className="text-emerald-400 hover:underline">/admin/intel-health</Link> (newsroom pipeline view) ·{" "}
          <Link href="/admin/data-quality" className="text-emerald-400 hover:underline">/admin/data-quality</Link> (cross-table sanity checks)
        </p>
      </footer>
    </div>
  );
}

function HealthBadge({ fresh }: { fresh: "fresh" | "warn" | "stale" | "silent" | "unknown" }) {
  const tone =
    fresh === "fresh" ? "bg-emerald-700 text-zinc-50"
    : fresh === "warn" ? "bg-amber-700 text-zinc-50"
    : fresh === "stale" ? "bg-amber-900 text-amber-100"
    : fresh === "silent" ? "bg-red-700 text-zinc-50"
    : "bg-zinc-800 text-zinc-400";
  const label =
    fresh === "fresh" ? "✓ FRESH"
    : fresh === "warn" ? "⏰ WARN"
    : fresh === "stale" ? "⚠ STALE"
    : fresh === "silent" ? "🚨 SILENT"
    : "?";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold ${tone}`}>{label}</span>
  );
}
