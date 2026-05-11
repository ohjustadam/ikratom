import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "BoP Watch · State Pharmacy Board Monitoring",
  description:
    "iKratom monitors every U.S. state Board of Pharmacy daily for kratom-related rulemaking — the administrative path to a ban that bypasses the legislature. Live coverage status + flagged findings.",
};
export const dynamic = "force-dynamic";

type Source = {
  state: string;
  board_name: string;
  surface: string;
  kind: string;
  agenda_url: string;
  enabled: boolean;
  last_scraped_at: string | null;
  last_status: string | null;
  last_finding_count: number;
};
type Finding = {
  id: string;
  state: string;
  title: string;
  snippet: string | null;
  url: string | null;
  meeting_date: string | null;
  relevance: string;
  severity: string;
  alert_emitted_at: string | null;
  found_at: string;
  board_name: string;
  surface: string;
};

export default async function BopWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state: stateFilter } = await searchParams;
  const supabase = await createClient();

  const [{ data: sources }, { data: findings }] = await Promise.all([
    supabase.rpc("get_public_bop_sources"),
    supabase.rpc("get_public_bop_findings", { p_days: 90 }),
  ]);

  const allSources = (sources ?? []) as Source[];
  const allFindings = (findings ?? []) as Finding[];

  const enabledCount = allSources.filter((s) => s.enabled).length;
  const lastScrapeAt = allSources
    .map((s) => s.last_scraped_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  const okCount = allSources.filter((s) => s.last_status === "ok" || s.last_status === "no_findings").length;
  const errorCount = allSources.filter((s) => s.last_status === "error").length;

  const visibleFindings = stateFilter
    ? allFindings.filter((f) => f.state.toLowerCase() === stateFilter.toLowerCase())
    : allFindings;
  const directFindings = visibleFindings.filter((f) => f.relevance === "kratom_direct");
  const adjacentFindings = visibleFindings.filter((f) => f.relevance === "kratom_adjacent");

  // Group sources by state for the coverage map
  const sourcesByState = new Map<string, Source[]>();
  for (const s of allSources) {
    const arr = sourcesByState.get(s.state) ?? [];
    arr.push(s);
    sourcesByState.set(s.state, arr);
  }
  const stateRows = Array.from(sourcesByState.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/" className="text-xs text-zinc-500 hover:text-emerald-400">← Home</a>

      <header className="mt-2 mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Early-warning monitoring
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">BoP Watch</h1>
        <p className="mt-3 max-w-3xl text-zinc-400">
          Every U.S. state Board of Pharmacy can{" "}
          <strong className="text-zinc-100">schedule kratom administratively</strong>{" "}
          without a legislative vote. North Carolina has done it. Several other states
          have tried. iKratom monitors {enabledCount} state agency surfaces{" "}
          <strong className="text-zinc-100">daily</strong> so the kratom community
          can catch a hostile rule proposal the day it drops, not the week it goes
          into effect.
        </p>
      </header>

      {/* Live status banner */}
      <section className="mb-10 grid gap-4 sm:grid-cols-4">
        <StatCard label="Sources monitored" value={enabledCount} sub="states + DC" />
        <StatCard
          label="Scraped today"
          value={okCount}
          sub={okCount === enabledCount ? "all clear" : `${errorCount} error${errorCount === 1 ? "" : "s"}`}
          accent={okCount === enabledCount ? "ok" : errorCount > 5 ? "warn" : "neutral"}
        />
        <StatCard
          label="Kratom-direct findings"
          value={directFindings.length}
          sub={`last 90 days${stateFilter ? ` · ${stateFilter.toUpperCase()}` : ""}`}
          accent={directFindings.length > 0 ? "warn" : "ok"}
        />
        <StatCard
          label="Last sweep"
          value={lastScrapeAt ? new Date(lastScrapeAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—"}
          sub={lastScrapeAt ? new Date(lastScrapeAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "never"}
        />
      </section>

      {/* Findings */}
      <section className="mb-12">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-xl font-semibold">
            Flagged findings
            {stateFilter && <span className="text-zinc-500"> · {stateFilter.toUpperCase()}</span>}
          </h2>
          {stateFilter && (
            <a href="/bop-watch" className="text-xs text-emerald-400 hover:underline">
              ← All states
            </a>
          )}
        </div>

        {directFindings.length === 0 && adjacentFindings.length === 0 ? (
          <EmptyState stateFilter={stateFilter} />
        ) : (
          <div className="space-y-3">
            {directFindings.map((f) => <FindingCard key={f.id} f={f} />)}
            {adjacentFindings.map((f) => <FindingCard key={f.id} f={f} />)}
          </div>
        )}
      </section>

      {/* Coverage table */}
      <section className="mb-10">
        <h2 className="mb-3 text-xl font-semibold">Coverage</h2>
        <p className="mb-4 text-sm text-zinc-400">
          Every state we monitor. Click a state to filter findings.
        </p>
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="p-2 text-left">State</th>
                <th className="p-2 text-left">Agency · Surface</th>
                <th className="p-2 text-left">Status</th>
                <th className="p-2 text-right">Last scrape</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
              {stateRows.map(([state, rows]) =>
                rows.map((s) => (
                  <tr key={`${state}-${s.board_name}-${s.surface}`}>
                    <td className="p-2 align-top">
                      <a
                        href={`/bop-watch?state=${state}`}
                        className="font-mono text-xs text-emerald-400 hover:underline"
                      >
                        {state}
                      </a>
                    </td>
                    <td className="p-2 align-top">
                      <div className="text-zinc-200">{s.board_name}</div>
                      <div className="text-[11px] text-zinc-500">
                        {s.surface} ·{" "}
                        <a
                          href={s.agenda_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-zinc-500 hover:text-emerald-400"
                        >
                          source ↗
                        </a>
                      </div>
                    </td>
                    <td className="p-2 align-top text-[11px]">
                      {!s.enabled && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">paused</span>
                      )}
                      {s.enabled && s.last_status === "ok" && (
                        <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-emerald-300">live</span>
                      )}
                      {s.enabled && s.last_status === "no_findings" && (
                        <span className="rounded bg-emerald-950/30 px-1.5 py-0.5 text-emerald-400/70">all clear</span>
                      )}
                      {s.enabled && s.last_status === "error" && (
                        <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">retry pending</span>
                      )}
                      {s.enabled && !s.last_status && (
                        <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">pending</span>
                      )}
                    </td>
                    <td className="p-2 text-right align-top text-[11px] text-zinc-500">
                      {s.last_scraped_at
                        ? new Date(s.last_scraped_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
        <h3 className="mb-2 font-semibold text-zinc-200">How this works</h3>
        <p>
          Every day at 10:00 UTC a cron job pulls each board&apos;s public meeting
          agenda or rule-proposal page, extracts every linked agenda item, and
          flags anything mentioning kratom, mitragynine, 7-OH, or related
          scheduling language. Findings classified as{" "}
          <strong className="text-zinc-100">kratom-direct</strong> are surfaced here
          immediately; an admin reviews and can promote the hostile ones into the
          main alert feed which fans out to your push/email notifications.
        </p>
        <p className="mt-3 text-xs text-zinc-500">
          See something we should be watching that we&apos;re not? Submit a tip at{" "}
          <a href="/alerts/submit" className="text-emerald-400 hover:underline">/alerts/submit</a>.
        </p>
      </footer>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  sub: string;
  accent?: "ok" | "warn" | "neutral";
}) {
  const tone =
    accent === "ok" ? "text-emerald-300" :
    accent === "warn" ? "text-amber-300" :
    "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
      <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function EmptyState({ stateFilter }: { stateFilter?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-emerald-800/40 bg-emerald-950/10 p-8 text-center">
      <p className="text-3xl">✓</p>
      <h3 className="mt-3 text-lg font-semibold text-emerald-300">
        {stateFilter
          ? `No kratom-related BoP activity in ${stateFilter.toUpperCase()} (last 90 days)`
          : "No kratom-related BoP activity anywhere (last 90 days)"}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-400">
        That&apos;s the outcome we want. The monitoring is running daily — when
        something hostile lands, it&apos;ll surface here within 24 hours and the
        admin will get a push notification.
      </p>
    </div>
  );
}

function FindingCard({ f }: { f: Finding }) {
  const isDirect = f.relevance === "kratom_direct";
  const isHostile = f.severity === "hostile_proposal";
  const ring =
    isDirect && isHostile ? "border-red-700/50 bg-red-950/20" :
    isDirect ? "border-amber-700/40 bg-amber-950/10" :
    "border-zinc-800 bg-zinc-950/40";

  return (
    <article className={`rounded-lg border p-4 ${ring}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500">
            <a
              href={`/bop-watch?state=${f.state}`}
              className="text-emerald-400 hover:underline"
            >
              {f.state}
            </a>
            {" · "}
            {f.board_name} · {f.surface} · {new Date(f.found_at).toLocaleDateString()}
          </p>
          <h3 className="mt-1 font-medium text-zinc-100 break-words">{f.title}</h3>
          {f.snippet && (
            <p className="mt-1 text-sm text-zinc-400">{f.snippet}</p>
          )}
          {f.url && (
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block break-all text-xs text-emerald-400 hover:underline"
            >
              View source ↗
            </a>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-[10px]">
          {isDirect && (
            <span className={`rounded px-1.5 py-0.5 ${isHostile ? "bg-red-950/50 text-red-300" : "bg-amber-950/50 text-amber-300"}`}>
              kratom-direct
            </span>
          )}
          {!isDirect && f.relevance === "kratom_adjacent" && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-400">adjacent</span>
          )}
          {isHostile && (
            <span className="rounded bg-red-950/50 px-1.5 py-0.5 text-red-300">hostile</span>
          )}
          {f.alert_emitted_at && (
            <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-emerald-300">alert sent</span>
          )}
        </div>
      </div>
    </article>
  );
}
