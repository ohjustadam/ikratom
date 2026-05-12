import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "What calls work — community intel from real conversations",
  description: "Open intel: real conversations advocates have had with legislators, AI-summarized + admin-approved.",
};
export const dynamic = "force-dynamic";

const POS_COLORS: Record<string, string> = {
  supportive: "border-emerald-700/40 bg-emerald-950/10 text-emerald-300",
  opposed: "border-red-700/40 bg-red-950/10 text-red-300",
  undecided: "border-amber-700/40 bg-amber-950/10 text-amber-300",
  unclear: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
  not_discussed: "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

/**
 * /calls/board — the "what calls work" community intel board.
 *
 * Shows AI summaries from approved call_sessions where users opted in
 * to share. PII-redacted: only the legislator name + summary + position
 * indicator. No user identity, no raw transcript.
 *
 * Builds the open intel corpus the owner described: "what is government
 * actually saying" surfaced for the next advocate going into a similar call.
 */
export default async function CallsBoardPage({ searchParams }: { searchParams?: Promise<{ state?: string }> }) {
  const sp = (await searchParams) ?? {};
  const stateFilter = sp.state?.toUpperCase() ?? null;

  const sb = await createClient();
  let q = sb
    .from("call_sessions")
    .select("id, recipient_name, recipient_role, state, started_at, duration_seconds, outcome, ai_summary_md")
    .eq("moderation_status", "approved")
    .not("ai_summary_md", "is", null)
    .order("started_at", { ascending: false })
    .limit(50);
  if (stateFilter) q = q.eq("state", stateFilter);
  const { data: rows } = await q;

  // Group + count by state for the filter pills
  const { data: allApproved } = await sb
    .from("call_sessions")
    .select("state")
    .eq("moderation_status", "approved");
  const byState = new Map<string, number>();
  for (const r of allApproved ?? []) {
    const s = r.state ?? "?";
    byState.set(s, (byState.get(s) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/calls" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Calls
      </Link>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📞 What calls work
        </p>
        <h1 className="mt-2 text-3xl font-bold">Community intel from real conversations</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          AI-summarized highlights from approved advocate calls — what legislators
          actually said, what arguments landed, where pushback came from. User
          identity always redacted; only the recipient + position + summary is shown.
          Submit your own via the &ldquo;Submit for review&rdquo; toggle when you
          end a tracked call.
        </p>
      </header>

      {byState.size > 0 && (
        <nav className="mb-6 flex flex-wrap gap-2 text-xs">
          <Link
            href="/calls/board"
            className={`rounded px-3 py-1.5 ${!stateFilter ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
          >
            All ({allApproved?.length ?? 0})
          </Link>
          {Array.from(byState.entries()).sort((a, b) => b[1] - a[1]).map(([state, count]) => (
            <Link
              key={state}
              href={`/calls/board?state=${state}`}
              className={`rounded px-3 py-1.5 ${stateFilter === state ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
            >
              {state} ({count})
            </Link>
          ))}
        </nav>
      )}

      {(rows?.length ?? 0) === 0 ? (
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">📞</p>
          <p className="mt-2 text-sm text-zinc-400">
            {stateFilter ? `No approved calls from ${stateFilter} yet.` : "No approved calls yet."}
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Make a call from <Link href="/calls" className="text-emerald-400 hover:underline">your call dashboard</Link>{" "}
            and opt in to share when you end the session.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {rows?.map((c) => {
            const pos = (c.ai_summary_md ?? "").match(/\*\*Stated position:\*\*\s*(\w+)/i)?.[1]?.toLowerCase() ?? "unclear";
            return (
              <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-bold text-zinc-100">{c.recipient_name ?? "(legislator)"}</span>
                  {c.recipient_role && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{c.recipient_role}</span>}
                  {c.state && <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-500">{c.state}</span>}
                  <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${POS_COLORS[pos] ?? POS_COLORS.unclear}`}>
                    {pos.replace(/_/g, " ")}
                  </span>
                  {c.duration_seconds != null && (
                    <span className="text-[11px] text-zinc-500">{Math.round(c.duration_seconds / 60)}m</span>
                  )}
                  <span className="ml-auto text-[10px] text-zinc-600">
                    {(c.started_at ?? "").slice(0, 10)}
                  </span>
                </div>
                {c.ai_summary_md && (
                  <div className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                    {c.ai_summary_md}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
