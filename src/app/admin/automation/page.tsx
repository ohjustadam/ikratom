import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import {
  CRON_REGISTRY,
  totalExpectedRunsPerDay,
  blockedRunsPerDay,
  vercelRunsPerDay,
  ghBlockedCount,
  vercelCount,
  dbTriggerCount,
  type CronEntry,
  type CronCadence,
} from "@/lib/cron-registry";

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

// Expected interval per source — DERIVED from the single source of truth
// (CRON_REGISTRY) instead of a hand-maintained copy. The old duplicate map
// drifted: its source keys (sync_federal_awards, sync_courtlistener_cases,
// legiscan_full_sweep, …) no longer matched the strings the scripts actually
// write to scraper_runs.source (usaspending, courtlistener, sync_bills_legiscan_all,
// …), so real jobs rendered "untracked" and dead keys flagged false silence.
// Deriving from CRON_REGISTRY means there's now ONE place to keep accurate.
// Cadence → conservative staleness interval (a 30-min/hourly job should run at
// least every 4h after retries; daily every 36h; weekly every 9d). Realtime
// (db-trigger) jobs have no staleness window.
const CADENCE_INTERVAL_H: Record<CronCadence, number | null> = {
  "every-30min": 4,
  hourly: 4,
  daily: 36,
  weekly: 216,
  realtime: null,
};
const EXPECTED: Record<string, { interval_hours: number; cadence: string; system: string }> = {};
for (const c of CRON_REGISTRY) {
  if (!c.source) continue;
  const ih = CADENCE_INTERVAL_H[c.cadence];
  if (ih == null) continue; // realtime / no staleness window
  EXPECTED[c.source] = { interval_hours: ih, cadence: c.cadence, system: c.system };
}

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
  const ctx = await getAdminContext({ require: "view_ops_console" });
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

      {/* ── Impact projection: how big is the gap right now ────── */}
      {(() => {
        const totalPerDay = totalExpectedRunsPerDay();
        const blockedPerDay = blockedRunsPerDay();
        const vercelPerDay = vercelRunsPerDay();
        // Find oldest gh-* source last run, treat that as the gap start.
        // Floor at 0 in case there are no GH crons.
        let gapStartMs = Number.POSITIVE_INFINITY;
        for (const c of CRON_REGISTRY) {
          if (!c.system.startsWith("gh-") || !c.source) continue;
          const r = rows.find((x) => x.source === c.source);
          if (r?.last_at) {
            const t = new Date(r.last_at).getTime();
            if (t < gapStartMs) gapStartMs = t;
          }
        }
        const ghStaleSources = rows.filter((r) => {
          const reg = CRON_REGISTRY.find((c) => c.source === r.source);
          return reg?.system.startsWith("gh-") && (r.fresh === "silent" || r.fresh === "stale");
        });
        // Estimate days blocked from the most-recent gh-* run (heuristic —
        // we want the answer, not perfect precision).
        let mostRecentGhRun = 0;
        for (const r of rows) {
          const reg = CRON_REGISTRY.find((c) => c.source === r.source);
          if (!reg?.system.startsWith("gh-") || !r.last_at) continue;
          const t = new Date(r.last_at).getTime();
          if (t > mostRecentGhRun) mostRecentGhRun = t;
        }
        const daysBlocked = mostRecentGhRun > 0
          ? Math.max(0, (Date.now() - mostRecentGhRun) / 86_400_000 - 1)
          : 0;
        const missedSoFar = Math.round(blockedPerDay * daysBlocked);
        return (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
              📊 Impact projection
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ImpactCard
                tone="zinc"
                label="Total automations"
                value={CRON_REGISTRY.length.toString()}
                sub={`${vercelCount()} Vercel · ${ghBlockedCount()} GH Actions · ${dbTriggerCount()} DB trigger`}
              />
              <ImpactCard
                tone="emerald"
                label="Running normally"
                value={Math.round(vercelPerDay).toString()}
                sub={`runs/day via Vercel — unaffected by billing`}
              />
              <ImpactCard
                tone={ghStaleSources.length > 0 ? "red" : "emerald"}
                label="Currently blocked"
                value={Math.round(blockedPerDay).toString()}
                sub={`runs/day blocked by GH Actions billing`}
              />
              <ImpactCard
                tone={missedSoFar > 100 ? "red" : "zinc"}
                label="Missed since gap started"
                value={missedSoFar.toLocaleString()}
                sub={`~${daysBlocked.toFixed(1)}d at ${Math.round(blockedPerDay)} runs/day`}
              />
            </div>
            <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-950/15 p-3 text-[11px] text-amber-200">
              <strong>Once the repo goes public</strong> (GitHub Actions = unlimited free minutes for public repos):
              all <strong>{Math.round(blockedPerDay)} runs/day</strong> resume immediately.
              That&apos;s <strong>{Math.round(totalPerDay).toLocaleString()} total firings/day</strong> across the
              platform. The dropoff visible in the heatmap below disappears within hours.
            </p>
          </section>
        );
      })()}

      {/* ── 14-day calendar heatmap ────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          🗓 14-day run heatmap
        </h2>
        <p className="mb-3 text-[11px] text-zinc-400">
          Total cron firings per day across all sources. The cliff is the billing block start.
        </p>
        {(() => {
          // Bucket recentRunsAll by date (YYYY-MM-DD).
          type DayRow = { date: string; count: number };
          const byDay = new Map<string, number>();
          for (const r of (recentRunsAll ?? []) as Array<{ finished_at: string }>) {
            if (!r.finished_at) continue;
            const day = r.finished_at.slice(0, 10);
            byDay.set(day, (byDay.get(day) ?? 0) + 1);
          }
          const days: DayRow[] = [];
          for (let i = 13; i >= 0; i--) {
            const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
            days.push({ date: d, count: byDay.get(d) ?? 0 });
          }
          const max = Math.max(1, ...days.map((d) => d.count));
          return (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[10px] text-zinc-200">
              <div className="flex items-end gap-1 overflow-x-auto pb-2">
                {days.map((d) => {
                  const pct = d.count / max;
                  // 5-step ramp: empty (zinc-900), low (red-900), med (amber-700),
                  // high (emerald-600), full (emerald-500).
                  const tone =
                    d.count === 0 ? "bg-zinc-900 border-red-800/40"
                    : pct < 0.15 ? "bg-red-900/60"
                    : pct < 0.4 ? "bg-amber-800/70"
                    : pct < 0.7 ? "bg-emerald-700/80"
                    : "bg-emerald-500";
                  const height = Math.max(8, Math.round(pct * 80));
                  return (
                    <div key={d.date} className="flex min-w-[52px] flex-col items-center gap-1">
                      <div className="text-[9px] text-zinc-500">{d.count}</div>
                      <div
                        className={`w-full rounded-t border-t ${tone}`}
                        style={{ height: `${height}px` }}
                        title={`${d.date}: ${d.count} runs`}
                      />
                      <div className="text-[9px] text-zinc-500">{d.date.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-500">
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-zinc-900 border border-red-800/40" /> empty</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-red-900/60" /> low</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-amber-800/70" /> med</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-emerald-700/80" /> high</span>
                <span className="flex items-center gap-1"><span className="h-2 w-3 rounded bg-emerald-500" /> full</span>
              </div>
            </div>
          );
        })()}
      </section>

      {/* ── Terminal-style cron registry list ──────────────────── */}
      <section className="mb-8">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
          🖥 All automations ({CRON_REGISTRY.length}) — scroll
        </h2>
        <p className="mb-2 text-[11px] text-zinc-400">
          Every scheduled job + its last actual run + status. ● = recent run, ◌ = silent / never ran.
        </p>
        <div
          className="overflow-y-auto rounded-lg border border-zinc-800 bg-black p-3 font-mono text-[10.5px] leading-[1.5]"
          style={{ maxHeight: "420px" }}
        >
          {(() => {
            const now = Date.now();
            const sysTone: Record<CronEntry["system"], string> = {
              "vercel": "text-emerald-300",
              "gh-hourly": "text-amber-300",
              "gh-daily": "text-amber-300",
              "gh-weekly": "text-amber-300",
              "db-trigger": "text-violet-300",
              "local-box": "text-sky-300",
            };
            // Sort: gh-blocked first (most-urgent), then by system, then by source.
            const ordered = [...CRON_REGISTRY].sort((a, b) => {
              const aBlocked = a.system.startsWith("gh-") ? 0 : 1;
              const bBlocked = b.system.startsWith("gh-") ? 0 : 1;
              if (aBlocked !== bBlocked) return aBlocked - bBlocked;
              return (a.source ?? "").localeCompare(b.source ?? "");
            });
            return ordered.map((c) => {
              const r = c.source ? rows.find((x) => x.source === c.source) : null;
              let dot = "◌";
              let dotCls = "text-zinc-600";
              let timeStr = "never";
              let healthCls = "text-zinc-500";
              if (r?.last_at) {
                const ageH = (now - new Date(r.last_at).getTime()) / 3_600_000;
                timeStr = ageH < 1 ? `${(ageH * 60).toFixed(0)}m`
                  : ageH < 48 ? `${ageH.toFixed(1)}h`
                  : `${(ageH / 24).toFixed(1)}d`;
                if (r.fresh === "fresh") { dot = "●"; dotCls = "text-emerald-400"; healthCls = "text-emerald-300"; }
                else if (r.fresh === "warn") { dot = "●"; dotCls = "text-amber-400"; healthCls = "text-amber-300"; }
                else if (r.fresh === "stale") { dot = "●"; dotCls = "text-amber-500"; healthCls = "text-amber-400"; }
                else if (r.fresh === "silent") { dot = "◌"; dotCls = "text-red-500"; healthCls = "text-red-400"; }
              } else if (c.system === "db-trigger") {
                dot = "▷"; dotCls = "text-violet-400"; timeStr = "realtime"; healthCls = "text-violet-300";
              }
              const sysLabel = c.system.padEnd(11);
              const cadenceLabel = c.cadence.padEnd(13);
              return (
                <div key={`${c.system}-${c.source ?? c.label}`} className="hover:bg-zinc-950/50">
                  <span className={dotCls}>{dot}</span>{" "}
                  <span className={sysTone[c.system]}>{sysLabel}</span>
                  <span className="text-zinc-500">{cadenceLabel}</span>
                  <span className="text-zinc-200">{(c.source ?? c.label).padEnd(36)}</span>
                  <span className={healthCls}>last: {timeStr.padEnd(8)}</span>
                  <span className="text-zinc-600">  {c.runs_per_day < 1 ? c.runs_per_day.toFixed(2) : c.runs_per_day}×/d</span>
                </div>
              );
            });
          })()}
        </div>
        <p className="mt-2 text-[10px] text-zinc-500">
          Color = system: <span className="text-emerald-300">Vercel</span> · <span className="text-amber-300">GitHub Actions</span> · <span className="text-violet-300">DB trigger</span>. Dot color = recency: <span className="text-emerald-400">●</span> fresh · <span className="text-amber-400">●</span> warn/stale · <span className="text-red-500">◌</span> silent.
        </p>
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

function ImpactCard({
  tone, label, value, sub,
}: {
  tone: "red" | "amber" | "emerald" | "zinc";
  label: string;
  value: string;
  sub: string;
}) {
  const toneCls = {
    red: "border-red-700/40 bg-red-950/15",
    amber: "border-amber-700/40 bg-amber-950/15",
    emerald: "border-emerald-700/30 bg-emerald-950/10",
    zinc: "border-zinc-800 bg-zinc-950/40",
  }[tone];
  const valueCls = {
    red: "text-red-300",
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    zinc: "text-zinc-200",
  }[tone];
  return (
    <div className={`rounded-lg border ${toneCls} p-3`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${valueCls}`}>{value}</p>
      <p className="mt-1 text-[10px] text-zinc-500">{sub}</p>
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
