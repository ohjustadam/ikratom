import { createClient } from "@/lib/supabase/server";

type Source = {
  state: string;
  enabled: boolean;
  last_scraped_at: string | null;
  last_status: string | null;
};
type Finding = {
  id: string;
  state: string;
  title: string;
  url: string | null;
  relevance: string;
  severity: string;
  found_at: string;
  board_name: string;
};

/**
 * Compact BoP-watch summary, embeddable on /pulse, /dashboard, /bills,
 * etc. Reads via the public RPCs so the same component works for
 * signed-out and signed-in users alike.
 *
 * Props:
 *   state — optional 2-letter code; filters findings to that state and
 *           changes the "monitoring N states" line into "monitoring
 *           {state} BoP".
 *   compact — smaller layout for dashboard widgets (no Coverage CTA).
 *
 * Server component — no client-side JS. Renders zero-state cleanly
 * when no findings exist (the common case right now).
 */
export async function BopWatchSummary({
  state,
  compact = false,
}: {
  state?: string;
  compact?: boolean;
}) {
  const supabase = await createClient();

  const [{ data: sourcesRaw }, { data: findingsRaw }] = await Promise.all([
    supabase.rpc("get_public_bop_sources"),
    supabase.rpc("get_public_bop_findings", { p_days: 90 }),
  ]);

  const sources = (sourcesRaw ?? []) as Source[];
  const findings = (findingsRaw ?? []) as Finding[];

  const enabledCount = sources.filter((s) => s.enabled).length;
  const okToday = sources.filter(
    (s) =>
      s.enabled &&
      (s.last_status === "ok" || s.last_status === "no_findings")
  ).length;

  // Most recent successful scrape timestamp.
  const lastScrapeAt = sources
    .map((s) => s.last_scraped_at)
    .filter((d): d is string => !!d)
    .sort()
    .pop();

  // Filter findings if state-scoped.
  const filteredFindings = state
    ? findings.filter((f) => f.state.toLowerCase() === state.toLowerCase())
    : findings;
  const direct = filteredFindings.filter((f) => f.relevance === "kratom_direct");

  // Compact = dashboard tile. Skip the coverage CTA, smaller header.
  if (compact) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <header className="flex items-baseline justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-purple-400">
            BoP Watch{state ? ` · ${state}` : ""}
          </p>
          <a href={state ? `/bop-watch?state=${state}` : "/bop-watch"} className="text-[11px] text-emerald-400 hover:underline">
            View →
          </a>
        </header>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-[11px] text-zinc-500">Monitored</p>
            <p className="font-bold text-zinc-100">{state ? "1" : enabledCount}</p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">Direct findings</p>
            <p className={`font-bold ${direct.length > 0 ? "text-amber-300" : "text-emerald-300"}`}>
              {direct.length}
              <span className="ml-1 text-[10px] font-normal text-zinc-500">90d</span>
            </p>
          </div>
        </div>
        {direct.length > 0 ? (
          <p className="mt-2 text-[11px] text-amber-300/80">
            ⚠ {direct.length} kratom-related agenda item{direct.length === 1 ? "" : "s"} detected
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500">
            ✓ {state ? `${state}'s BoP is clear` : "No hostile rulemaking detected anywhere"}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <header className="mb-3 flex items-baseline justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-purple-400">
            Board of Pharmacy Watch
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-zinc-100">
            {state
              ? `Monitoring ${state}'s Board of Pharmacy`
              : `Monitoring ${enabledCount} state Boards of Pharmacy`}
          </h2>
        </div>
        <a
          href={state ? `/bop-watch?state=${state}` : "/bop-watch"}
          className="text-xs text-emerald-400 hover:underline"
        >
          Open BoP Watch →
        </a>
      </header>

      <p className="text-sm text-zinc-400">
        {state
          ? `${state}'s state pharmacy board can administratively schedule kratom without a legislative vote. We scrape their agenda + rule proposals every day.`
          : `Every U.S. state BoP can schedule kratom administratively without a legislative vote. We scrape every state's agenda + rule proposals every day.`}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Scraped today" value={state ? "—" : `${okToday}/${enabledCount}`} />
        <Stat
          label="Direct findings"
          value={direct.length}
          accent={direct.length > 0 ? "warn" : "ok"}
          sub="last 90 days"
        />
        <Stat
          label="Last sweep"
          value={
            lastScrapeAt
              ? new Date(lastScrapeAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
              : "—"
          }
        />
      </div>

      {direct.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {direct.slice(0, 3).map((f) => (
            <li
              key={f.id}
              className="rounded-md border border-amber-700/30 bg-amber-950/10 p-3 text-sm"
            >
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                {f.state} · {f.board_name}
              </p>
              <p className="mt-0.5 text-zinc-100">{f.title}</p>
              {f.url && (
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block break-all text-[11px] text-emerald-400 hover:underline"
                >
                  Source ↗
                </a>
              )}
            </li>
          ))}
          {direct.length > 3 && (
            <p className="text-xs text-zinc-500">
              + {direct.length - 3} more →{" "}
              <a
                href={state ? `/bop-watch?state=${state}` : "/bop-watch"}
                className="text-emerald-400 hover:underline"
              >
                see all
              </a>
            </p>
          )}
        </ul>
      ) : (
        <p className="mt-4 rounded-md border border-emerald-800/30 bg-emerald-950/10 p-3 text-sm text-emerald-300">
          ✓ No kratom-related BoP activity{state ? ` in ${state}` : ""} in the last 90 days.
          The monitoring is running daily — when something hostile lands, it&apos;ll surface
          here within 24 hours.
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "ok" | "warn" | "neutral";
}) {
  const tone =
    accent === "ok"
      ? "text-emerald-300"
      : accent === "warn"
      ? "text-amber-300"
      : "text-zinc-100";
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}
