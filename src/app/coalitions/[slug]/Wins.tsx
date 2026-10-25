import { plural, winLines, type WinsRow } from "@/modules/coalitions/home";

/**
 * The group's wins this week (migration 0284, owner pick B15b). COUNTS ONLY:
 * no names, no "who did what", ever. Members see it; on a public group, so
 * does a signed-in visitor, because the numbers are the recruiting pitch.
 */

export function Wins({ w }: { w: WinsRow }) {
  const lines = winLines(w);

  return (
    <section id="wins" className="mb-6 rounded-xl border border-amber-600/30 bg-amber-950/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-amber-200">🏆 This week&apos;s wins</h2>
        {w.letters_total > 0 && (
          <span className="text-[11px] text-zinc-400">{plural(w.letters_total, "letter")} since the group began</span>
        )}
      </div>
      {lines.length > 0 ? (
        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {lines.map((l) => (
            <li key={l.text} className="flex items-center gap-2 rounded-md bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100">
              <span aria-hidden>{l.icon}</span>{l.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-zinc-400">
          Nothing yet this week. Every letter, new member and event shows up here as the group&apos;s win.
        </p>
      )}
      <p className="mt-2 text-[11px] text-zinc-500">Counts only. Nobody&apos;s name is ever shown here.</p>
    </section>
  );
}
