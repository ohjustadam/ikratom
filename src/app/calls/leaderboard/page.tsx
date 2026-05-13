import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Leaderboard — top callers · iKratom",
  description: "See which advocates are making the most kratom-policy calls to legislators this week, this month, and all time.",
};
export const dynamic = "force-dynamic";

type Window = "week" | "month" | "all";

type LeaderRow = {
  user_id: string;
  count: number;
  state: string | null;
  distinct_recipients: number;
};

const WINDOW_DAYS: Record<Window, number | null> = {
  week: 7,
  month: 30,
  all: null,
};

const WINDOW_LABELS: Record<Window, string> = {
  week: "This week",
  month: "This month",
  all: "All time",
};

/**
 * Pull leaderboard rows for a given window. Privacy: aggregates from
 * call_sessions (RLS-protected — admin/service-role bypass), then
 * joins to public_profiles RPC so only opt-in users get their name
 * shown. Non-public users render as "Advocate from {state}".
 */
async function getLeaderboard(window: Window): Promise<LeaderRow[]> {
  const sb = await createClient();
  const since = WINDOW_DAYS[window] != null
    ? new Date(Date.now() - WINDOW_DAYS[window]! * 86_400_000).toISOString()
    : null;

  // Fetch all relevant call sessions (just the fields we need for aggregation).
  // call_sessions RLS allows reading own rows by default but the server
  // component here uses the regular cookies-session client — that
  // means each viewer only sees their own data through normal RLS.
  //
  // For the leaderboard to surface global counts we need an aggregated
  // view that doesn't expose individual rows. Use the RPC defined in
  // 0118_call_leaderboard.sql which counts publicly without leaking
  // transcripts.
  const { data, error } = await sb.rpc("call_leaderboard", {
    p_since: since,
    p_limit: 25,
  });
  if (error || !data) {
    return [];
  }
  return data as LeaderRow[];
}

export default async function CallsLeaderboardPage({ searchParams }: {
  searchParams?: Promise<{ w?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const window: Window = (["week", "month", "all"].includes(sp.w ?? "")
    ? (sp.w as Window)
    : "week");

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const rows = await getLeaderboard(window);

  // Look up public-visible display info for the leaderboard user IDs.
  // Anyone not returned by the RPC is non-public — shown as anonymous.
  let publicProfiles: Map<string, { username: string | null; full_name: string | null; state: string | null; avatar_url: string | null }> = new Map();
  if (rows.length > 0) {
    const { data: profs } = await sb.rpc("get_public_profiles", {
      p_ids: rows.map((r) => r.user_id),
    });
    publicProfiles = new Map(
      ((profs ?? []) as Array<{ id: string; username: string | null; full_name: string | null; state: string | null; avatar_url: string | null }>)
        .map((p) => [p.id, { username: p.username, full_name: p.full_name, state: p.state, avatar_url: p.avatar_url }])
    );
  }

  // Display name resolver: prefer username, fall back to full first name,
  // and finally anonymize as "Advocate from {state}".
  const displayName = (r: LeaderRow): { name: string; anonymous: boolean; avatar: string | null } => {
    const p = publicProfiles.get(r.user_id);
    if (p?.username) return { name: `@${p.username}`, anonymous: false, avatar: p.avatar_url };
    if (p?.full_name) {
      // First name only — protect last names even for opted-in users
      const first = p.full_name.split(/\s+/)[0];
      return { name: first || "Advocate", anonymous: false, avatar: p.avatar_url };
    }
    return { name: `Advocate from ${r.state ?? "?"}`, anonymous: true, avatar: null };
  };

  // Find current user's rank if they're in the leaderboard
  const myRank = user ? rows.findIndex((r) => r.user_id === user.id) : -1;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/calls" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Call dashboard
      </Link>

      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          🏆 Top callers
        </p>
        <h1 className="mt-2 text-3xl font-bold">Leaderboard</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Phone calls move legislators more than any other action. Here are
          the advocates putting in the work. Names shown only for users
          who set their profile to public — everyone else stays anonymous.
        </p>
      </header>

      {/* Window tabs */}
      <nav className="mb-4 flex flex-wrap gap-2 text-xs">
        {(["week", "month", "all"] as Window[]).map((w) => (
          <Link
            key={w}
            href={`/calls/leaderboard?w=${w}`}
            className={`rounded px-3 py-1.5 ${window === w
              ? "bg-emerald-600 text-zinc-950"
              : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
          >
            {WINDOW_LABELS[w]}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-10 text-center">
          <p className="text-3xl">📞</p>
          <p className="mt-2 text-sm text-zinc-400">
            No tracked calls yet for {WINDOW_LABELS[window].toLowerCase()}.
            Be the first to land on this list.
          </p>
          {user && (
            <Link href="/calls" className="mt-3 inline-block rounded bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400">
              Make your first call →
            </Link>
          )}
        </div>
      ) : (
        <ol className="space-y-1">
          {rows.map((r, i) => {
            const d = displayName(r);
            const isMe = user?.id === r.user_id;
            const rank = i + 1;
            const rankEmoji = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
            return (
              <li
                key={r.user_id}
                className={`flex items-baseline gap-3 rounded-md border p-3 ${
                  isMe ? "border-emerald-500 bg-emerald-950/30" : "border-zinc-800 bg-zinc-950/40"
                }`}
              >
                <span className={`w-9 flex-none text-center text-base font-bold ${rank <= 3 ? "" : "text-zinc-500"}`}>
                  {rankEmoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${d.anonymous ? "italic text-zinc-400" : "text-zinc-100"}`}>
                    {d.name}
                    {isMe && <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-950">You</span>}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {r.distinct_recipients} distinct rep{r.distinct_recipients === 1 ? "" : "s"} · {r.state ?? "?"}
                  </p>
                </div>
                <div className="flex-none text-right">
                  <p className="text-lg font-bold text-zinc-100 tabular-nums">{r.count}</p>
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500">calls</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {user && myRank === -1 && rows.length > 0 && (
        <div className="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/15 p-3 text-xs text-zinc-300">
          Not on the board yet? <Link href="/calls" className="font-semibold text-emerald-400 hover:underline">Place your first tracked call →</Link>
        </div>
      )}

      <p className="mt-6 text-[10px] text-zinc-600">
        Privacy: only users with profile visibility set to <span className="font-mono">public</span> appear by name.
        Others are aggregated anonymously by state. Set your visibility in <Link href="/account/character" className="text-emerald-400 hover:underline">your profile</Link>.
      </p>
    </div>
  );
}
