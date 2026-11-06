import Link from "@/components/Link";
import type { ContentSignals as Signals, Counted } from "@/lib/abuse-content-signals";

function Tile({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${value > 0 ? "text-amber-300" : "text-zinc-300"}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{note}</p>
    </div>
  );
}

function Repeats({ title, rows }: { title: string; rows: Counted[] }) {
  if (!rows.length) return null;
  return (
    <p className="mt-2 text-xs text-zinc-400">
      {title}: {rows.map((r) => `${r.handle} (${r.count})`).join(", ")}
    </p>
  );
}

/** Signals from inside the site, past sign-up. Members appear by @username only. */
export default function ContentSignals({ data }: { data: Signals }) {
  const { blocks, newReporters, hidden, newGroups } = data;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">Inside the site (7d)</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Letters refused" value={blocks.total} note={`${blocks.banAsks} ban asks, ${blocks.threats} threats, ${blocks.accounts} accounts`} />
        <Tile label="Reports by new accounts" value={newReporters.reports} note={`${newReporters.accounts} accounts under 7 days old`} />
        <Tile label="Hidden by reports" value={hidden} note="reported this week and hidden now" />
        <Tile label="Groups by new accounts" value={newGroups.length} note="started by accounts under 7 days old" />
      </div>
      <Repeats title="Refused more than once" rows={blocks.repeat} />
      <Repeats title="Reporting more than once while new" rows={newReporters.top} />
      {newGroups.length > 0 && (
        <p className="mt-2 text-xs text-zinc-400">
          New accounts&apos; groups:{" "}
          {newGroups.map((g, i) => (
            <span key={g.slug}>
              {i > 0 && ", "}
              <Link href={`/coalitions/${g.slug}`} className="text-amber-400 underline hover:text-amber-300">{g.name}</Link> ({g.handle})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
