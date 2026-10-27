import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { GROUP_BADGES, groupBadge, plural } from "@/modules/coalitions/home";
import { LeaderboardToggle } from "./LeaderboardToggle";

/**
 * The group badge and the opt-in leaderboard (migration 0294, B4 g). Only
 * members who turned it on are listed, by @handle, with their action counts.
 * Everyone else stays off it: it is off by default.
 */
type Row = { user_id: string; actions_30d: number; actions_total: number };

export async function Leaderboard({ coalitionId, slug, userId, lettersTotal }: {
  coalitionId: string; slug: string; userId: string; lettersTotal: number;
}) {
  const sb = await createClient();
  const [{ data: board }, { data: me }] = await Promise.all([
    sb.rpc("coalition_leaderboard", { p_coalition_id: coalitionId }),
    sb.from("coalition_members").select("leaderboard_opt_in_at").eq("coalition_id", coalitionId).eq("user_id", userId).maybeSingle(),
  ]);
  const rows = (board ?? []) as Row[];
  const handles = new Map<string, string>();
  if (rows.length > 0) {
    const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: rows.map((r) => r.user_id) });
    for (const p of (profs ?? []) as { id: string; username: string | null; state: string | null }[]) handles.set(p.id, publicHandle(p));
  }
  const badge = groupBadge(lettersTotal);
  const next = badge ? badge.next : { name: GROUP_BADGES[0].name, at: GROUP_BADGES[0].min };
  const optedIn = !!me?.leaderboard_opt_in_at;

  return (
    <section id="leaderboard" className="mb-6 scroll-mt-20">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">🏅 Group badge and leaderboard</h2>
      <p className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-200">
        {badge ? <><span aria-hidden>{badge.icon}</span> <strong>{badge.name}</strong> group · {plural(lettersTotal, "letter")} sent</> : <>{plural(lettersTotal, "letter")} sent so far</>}
        {next && <span className="block text-xs text-zinc-400">Next badge: {next.name} at {next.at} letters.</span>}
      </p>
      {rows.length > 0 ? (
        <ol className="mb-3 space-y-1.5 text-sm">
          {rows.map((r, i) => (
            <li key={r.user_id} className="flex items-baseline gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <span className="w-6 shrink-0 text-xs text-zinc-500">{i + 1}.</span>
              <span className={`font-semibold ${r.user_id === userId ? "text-amber-300" : "text-emerald-300"}`}>{handles.get(r.user_id) ?? "@member"}</span>
              <span className="ml-auto text-xs text-zinc-400">
                <strong className="text-zinc-100">{r.actions_30d}</strong> in 30 days · {r.actions_total} total
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mb-3 text-sm text-zinc-400">Nobody is on the leaderboard yet.</p>
      )}
      <LeaderboardToggle coalitionId={coalitionId} slug={slug} optedIn={optedIn} />
      <p className="mt-2 text-[11px] text-zinc-500">
        Off unless you turn it on. Only your @username and how many actions you took are shown, to members of this group.
      </p>
    </section>
  );
}
