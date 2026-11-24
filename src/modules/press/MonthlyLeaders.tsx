import type { Leader } from "./board-data";

/**
 * This month's most active answerers on /media. @username only, and only for
 * public profiles; everyone else is "An advocate" (public anonymity rule).
 */
export function MonthlyLeaders({ leaders }: { leaders: Leader[] }) {
  if (!leaders.length) return null;
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">This month&apos;s top answerers</h2>
      <p className="mt-1 text-xs text-zinc-500">Emails to writers plus comments ticked, since the 1st. Only public profiles show a name.</p>
      <ol className="mt-3 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
        {leaders.map((l, i) => (
          <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
            <span className="text-zinc-300">
              <span className="mr-2 text-zinc-500">{i + 1}.</span>
              {l.handle ? `@${l.handle}` : "An advocate"}
            </span>
            <span className="text-zinc-400">{l.actions}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
