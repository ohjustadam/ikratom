import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyCalls, listMyAchievements } from "@/modules/calls/actions";

export const metadata = { title: "Your call history · iKratom" };
export const dynamic = "force-dynamic";

const OUTCOME_META: Record<string, { label: string; tone: string; emoji: string }> = {
  reached: { label: "Reached", tone: "text-emerald-300", emoji: "✓" },
  voicemail: { label: "Voicemail", tone: "text-amber-300", emoji: "📨" },
  busy: { label: "Busy", tone: "text-zinc-400", emoji: "📵" },
  declined: { label: "Declined", tone: "text-red-300", emoji: "🚫" },
  no_answer: { label: "No answer", tone: "text-zinc-400", emoji: "⌛" },
};

const BADGE_META: Record<string, { emoji: string; title: string }> = {
  first_call: { emoji: "🎉", title: "First call" },
  capital_seven: { emoji: "🏛️", title: "Capital Seven" },
  coast_to_coast: { emoji: "🗺️", title: "Coast to Coast" },
  century_club: { emoji: "💯", title: "Century Club" },
};

function formatDur(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * /account/calls — personal call history.
 *
 * Fills the gap where multiple surfaces linked here ("See your call
 * history →" after a call ends, the share-call CTA's followup link,
 * the revalidatePath target after submit-for-review) but the route
 * didn't exist.
 *
 * Surfaces:
 *   - Personal stats (total calls, reached %, distinct reps, total airtime)
 *   - Badges grid
 *   - Last 30 calls with outcome, duration, AI summary preview
 *   - Leaderboard cross-link
 */
export default async function CallHistoryPage() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?redirect=/account/calls");

  const calls = await listMyCalls(50);
  const achievements = await listMyAchievements();

  const completedCalls = calls.filter((c) => c.ended_at);
  const reachedCalls = completedCalls.filter((c) => c.outcome === "reached");
  const distinctRecipients = new Set(completedCalls.map((c) => c.recipient_name).filter(Boolean)).size;
  const totalDurationSec = completedCalls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0);
  const totalMin = Math.floor(totalDurationSec / 60);
  const reachRate = completedCalls.length > 0
    ? Math.round((reachedCalls.length / completedCalls.length) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </Link>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📞 Call history
        </p>
        <h1 className="mt-2 text-3xl font-bold">Every call you&apos;ve tracked</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Phone calls are the highest-leverage action you take. Here&apos;s
          your record. Approved transcripts feed the community intel
          pool — find what&apos;s working at <Link href="/calls/board" className="text-emerald-400 hover:underline">/calls/board</Link>.
        </p>
      </header>

      {/* Stats grid */}
      <section className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Total calls" value={completedCalls.length} />
        <Stat label="Reached" value={reachedCalls.length} sub={`${reachRate}% rate`} />
        <Stat label="Distinct reps" value={distinctRecipients} />
        <Stat label="Total airtime" value={totalMin > 0 ? `${totalMin}m` : "—"} />
      </section>

      {/* Badges */}
      {achievements.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
            🏅 Badges earned
          </h2>
          <div className="flex flex-wrap gap-2">
            {achievements.map((a) => {
              const meta = BADGE_META[a.badge_code] ?? { emoji: "✨", title: a.badge_code };
              return (
                <div
                  key={a.badge_code}
                  className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-2"
                >
                  <span className="text-lg" aria-hidden>{meta.emoji}</span>{" "}
                  <span className="text-xs font-semibold text-emerald-200">{meta.title}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Quick links */}
      <section className="mb-6 flex flex-wrap gap-2 text-xs">
        <Link href="/calls" className="rounded bg-emerald-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400">
          📞 Make another call →
        </Link>
        <Link href="/calls/leaderboard" className="rounded border border-amber-700/40 bg-amber-950/20 px-3 py-1.5 text-amber-200 hover:border-amber-500">
          🏆 Leaderboard
        </Link>
        <Link href="/calls/board" className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 hover:border-emerald-500">
          📞 Community intel
        </Link>
      </section>

      {/* Call list */}
      {calls.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">📞</p>
          <p className="mt-2 text-sm text-zinc-400">
            No calls tracked yet. The hardest one is the first — start now.
          </p>
          <Link href="/calls" className="mt-3 inline-block rounded bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400">
            Find a target →
          </Link>
        </div>
      ) : (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Last {calls.length} call{calls.length === 1 ? "" : "s"}
          </h2>
          <ul className="space-y-2">
            {calls.map((c) => {
              const outcome = c.outcome ? OUTCOME_META[c.outcome] : null;
              const started = new Date(c.started_at);
              const isUnfinished = !c.ended_at;
              return (
                <li
                  key={c.id}
                  className={`rounded-md border p-3 ${
                    isUnfinished
                      ? "border-amber-700/30 bg-amber-950/10"
                      : c.outcome === "reached"
                      ? "border-emerald-700/30 bg-emerald-950/10"
                      : "border-zinc-800 bg-zinc-950/40"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    {c.state && (
                      <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-300">
                        {c.state}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-zinc-100">
                      {c.recipient_name ?? "(no recipient)"}
                    </span>
                    {c.recipient_role && (
                      <span className="text-[11px] text-zinc-500">{c.recipient_role}</span>
                    )}
                    {outcome && (
                      <span className={`text-[11px] font-semibold ${outcome.tone}`}>
                        {outcome.emoji} {outcome.label}
                      </span>
                    )}
                    {isUnfinished && (
                      <span className="text-[11px] text-amber-300">⏱ unfinished</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-zinc-500">
                      {formatDur(c.duration_seconds)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    {started.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    {c.moderation_status === "pending_review" && (
                      <span className="ml-2 rounded bg-amber-950/40 px-1.5 py-0.5 text-amber-300">
                        submitted for review
                      </span>
                    )}
                    {c.moderation_status === "approved" && (
                      <span className="ml-2 rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300">
                        ✓ in community intel
                      </span>
                    )}
                  </p>
                  {c.ai_summary_md && (
                    <p className="mt-2 line-clamp-2 text-xs italic text-zinc-300">
                      &ldquo;{c.ai_summary_md.slice(0, 200)}{c.ai_summary_md.length > 200 ? "…" : ""}&rdquo;
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="mt-8 text-[10px] text-zinc-600">
        Your call history is private by default. Transcripts only enter the
        community intel pool if you opt in per-call AND admin approves.
        Delete anytime via the iKratom data-export request flow.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-zinc-500">{sub}</p>}
    </div>
  );
}
