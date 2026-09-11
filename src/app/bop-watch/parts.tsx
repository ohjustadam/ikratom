import Link from "next/link";
import type { Finding } from "./types";

/**
 * Presentational pieces of /bop-watch. Deliberately NOT marked "use client":
 * the server page renders them directly for the static HTML, and the client
 * filter shell (FilteredView.tsx) renders the same components again once it
 * knows the `?state=` param. Same markup either way, so applying a filter
 * never changes anything but which rows are shown.
 *
 * Everything here is public BoP record — no viewer identity, nothing
 * per-user — so it is safe to bake into a shared cached page.
 */

/** Findings matching the (optional) 2-letter state filter, kratom-direct only. */
export function countDirect(findings: Finding[], stateFilter?: string): number {
  return findings.filter(
    (f) =>
      f.relevance === "kratom_direct" &&
      (!stateFilter || f.state.toLowerCase() === stateFilter.toLowerCase()),
  ).length;
}

export function StatCard({
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
      <p className="text-xs uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}

export function FindingsList({
  findings,
  stateFilter,
}: {
  findings: Finding[];
  stateFilter?: string;
}) {
  const visible = stateFilter
    ? findings.filter((f) => f.state.toLowerCase() === stateFilter.toLowerCase())
    : findings;
  const direct = visible.filter((f) => f.relevance === "kratom_direct");
  const adjacent = visible.filter((f) => f.relevance === "kratom_adjacent");

  return (
    <section className="mb-12">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold">
          Flagged findings
          {stateFilter && <span className="text-zinc-500"> · {stateFilter.toUpperCase()}</span>}
        </h2>
        {stateFilter && (
          <Link href="/bop-watch" className="text-xs text-emerald-400 hover:underline">
            ← All states
          </Link>
        )}
      </div>

      {direct.length === 0 && adjacent.length === 0 ? (
        <EmptyState stateFilter={stateFilter} />
      ) : (
        <div className="space-y-3">
          {direct.map((f) => <FindingCard key={f.id} f={f} />)}
          {adjacent.map((f) => <FindingCard key={f.id} f={f} />)}
        </div>
      )}
    </section>
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
            <Link href={`/bop-watch?state=${f.state}`} className="text-emerald-400 hover:underline">
              {f.state}
            </Link>
            {" · "}
            {f.board_name} · {f.surface} · {new Date(f.found_at).toLocaleDateString()}
          </p>
          <h3 className="mt-1 font-medium text-zinc-100 break-words">{f.title}</h3>
          {f.snippet && (
            <p className="mt-1 text-sm text-zinc-400">{f.snippet}</p>
          )}
          {f.ai_reasoning && (
            <p className="mt-2 rounded-md border border-emerald-800/30 bg-emerald-950/10 p-2 text-xs italic text-emerald-200/90">
              <span className="font-semibold text-emerald-300">AI verdict</span>
              {f.ai_confidence !== null && (
                <span className="text-emerald-400/70"> · {Math.round(f.ai_confidence * 100)}% conf.</span>
              )}{" "}
              — {f.ai_reasoning}
            </p>
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
