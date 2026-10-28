import { unstable_cache } from "next/cache";
import Link from "@/components/Link";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AgoText, OpenLoungeButton } from "./HomeCommunityActions";

/**
 * The community strip at the very top of the home page (owner ask 2026-10-28):
 * the social side is visible before anything else. Lounge activity, groups,
 * and letters sent this week.
 *
 * Honest at small numbers: it shows activity ("last message 12m ago"), never a
 * headcount that would make a young community look empty, and never a handle
 * (the Lounge is members-only, so nobody's name leaks onto the public page).
 * Aggregates only, from a cookieless service-role snapshot cached 5 minutes,
 * the same pattern as the rest of the home page; the relative time is worked
 * out in the browser so a cached page never shows a stale "2m ago".
 */
type Pulse = { lastLoungeAt: string | null; loungeToday: number; lettersWeek: number };

const getCommunityPulse = unstable_cache(
  async (): Promise<Pulse> => {
    const sb = createServiceRoleClient();
    const day = new Date(Date.now() - 86_400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [last, today, letters] = await Promise.all([
      sb.from("chat_messages").select("created_at").eq("room", "lounge").order("created_at", { ascending: false }).limit(1),
      sb.from("chat_messages").select("id", { count: "exact", head: true }).eq("room", "lounge").gte("created_at", day),
      sb.from("campaign_actions").select("id", { count: "exact", head: true }).gte("sent_at", week),
    ]);
    return {
      lastLoungeAt: (last.data?.[0]?.created_at as string | undefined) ?? null,
      loungeToday: today.count ?? 0,
      lettersWeek: letters.count ?? 0,
    };
  },
  ["home-community-pulse"],
  { revalidate: 300 },
);

// Phones: three compact tiles in one row (icon over title) so the hero stays in
// the first screen; wider screens add the second line.
const card =
  "flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-xs transition sm:flex-row sm:items-center sm:gap-2 sm:px-3 sm:text-sm";

export async function HomeCommunityStrip() {
  const p = await getCommunityPulse().catch(() => null);
  if (!p) return null;
  return (
    <div className="mb-6 grid grid-cols-3 gap-2" aria-label="Community right now">
      <OpenLoungeButton className={`${card} border-emerald-700/50 bg-emerald-950/20 text-left hover:border-emerald-400`}>
        <span aria-hidden>💬</span>
        <span className="min-w-0">
          <span className="block font-semibold leading-tight text-zinc-100">Lounge<span className="hidden sm:inline"> · live chat</span></span>
          <span className="hidden truncate text-xs text-zinc-400 sm:block">
            {p.loungeToday > 0
              ? `${p.loungeToday} message${p.loungeToday === 1 ? "" : "s"} today · join in →`
              : p.lastLoungeAt
                ? <>Last message <AgoText iso={p.lastLoungeAt} /> · say hi →</>
                : "Be the first to say hi →"}
          </span>
        </span>
      </OpenLoungeButton>
      <Link href="/coalitions" className={`${card} border-zinc-800 bg-zinc-900/60 hover:border-emerald-500`}>
        <span aria-hidden>👥</span>
        <span className="min-w-0">
          <span className="block font-semibold leading-tight text-zinc-100">Groups and friends</span>
          <span className="hidden truncate text-xs text-zinc-400 sm:block">Find or start one for your state →</span>
        </span>
      </Link>
      <Link href="/campaigns" className={`${card} border-zinc-800 bg-zinc-900/60 hover:border-emerald-500`}>
        <span aria-hidden>✉️</span>
        <span className="min-w-0">
          <span className="block font-semibold leading-tight text-zinc-100">
            {p.lettersWeek > 0 ? `${p.lettersWeek.toLocaleString()} letters this week` : "Letters to officials"}
          </span>
          <span className="hidden truncate text-xs text-zinc-400 sm:block">
            {p.lettersWeek > 0 ? "Sent by members · add yours →" : "Send this week's first one →"}
          </span>
        </span>
      </Link>
    </div>
  );
}
