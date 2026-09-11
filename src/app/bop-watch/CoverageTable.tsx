import Link from "next/link";
import type { Source } from "./types";

/**
 * Every monitored board, grouped by state. Filter-INDEPENDENT — it always
 * lists all 50 states + DC — so it stays a server component and lands in the
 * static HTML, which is where most of this page's indexable content lives.
 */
export function CoverageTable({ sources }: { sources: Source[] }) {
  const byState = new Map<string, Source[]>();
  for (const s of sources) {
    const arr = byState.get(s.state) ?? [];
    arr.push(s);
    byState.set(s.state, arr);
  }
  const stateRows = Array.from(byState.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
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
                    <Link
                      href={`/bop-watch?state=${state}`}
                      className="font-mono text-xs text-emerald-400 hover:underline"
                    >
                      {state}
                    </Link>
                  </td>
                  <td className="p-2 align-top">
                    <div className="text-zinc-200">{s.board_name}</div>
                    <div className="text-xs text-zinc-400">
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
                  <td className="p-2 align-top text-xs">
                    <StatusPill enabled={s.enabled} status={s.last_status} />
                  </td>
                  <td className="p-2 text-right align-top text-xs text-zinc-400">
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
  );
}

function StatusPill({ enabled, status }: { enabled: boolean; status: string | null }) {
  if (!enabled) return <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">paused</span>;
  if (status === "ok") return <span className="rounded bg-emerald-950/50 px-1.5 py-0.5 text-emerald-300">live</span>;
  if (status === "no_findings") return <span className="rounded bg-emerald-950/30 px-1.5 py-0.5 text-emerald-400/70">all clear</span>;
  if (status === "error") return <span className="rounded bg-amber-950/50 px-1.5 py-0.5 text-amber-300">retry pending</span>;
  if (!status) return <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500">pending</span>;
  // Unrecognized status: render nothing, exactly as the original chain did.
  return null;
}
