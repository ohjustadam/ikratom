/**
 * Action streak widget for the dashboard. Renders nothing if user has
 * never taken an action; lights up once they have a streak going.
 */

export function StreakBadge({
  current,
  longest,
  lastActionDate,
}: {
  current: number;
  longest: number;
  lastActionDate: string | null;
}) {
  if (current === 0 && longest === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 p-4 text-center">
        <p className="text-sm text-zinc-300">
          🔥 Start your streak — send your first email to a legislator today.
        </p>
        <a
          href="/campaigns"
          className="mt-3 inline-block rounded-md bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Browse campaigns →
        </a>
      </div>
    );
  }

  // Stale: last action wasn't today or yesterday
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const stale = lastActionDate !== today && lastActionDate !== yesterday;

  return (
    <div className={`rounded-lg border p-4 ${stale ? "border-amber-700/40 bg-amber-950/20" : "border-emerald-700/40 bg-emerald-950/20"}`}>
      <div className="flex items-center gap-3">
        <div className="text-3xl">🔥</div>
        <div className="flex-1">
          <p className="text-2xl font-bold tabular-nums">
            {current} {current === 1 ? "day" : "days"}
            {stale && current > 0 && (
              <span className="ml-2 text-xs font-normal text-amber-300">streak ending</span>
            )}
          </p>
          <p className="text-xs text-zinc-400">
            {longest > current
              ? `Personal best: ${longest} days`
              : "All-time best"}
            {lastActionDate && (
              <span> · last action {new Date(lastActionDate).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        {stale && current > 0 && (
          <a
            href="/campaigns"
            className="shrink-0 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Don&apos;t break it →
          </a>
        )}
      </div>
    </div>
  );
}
