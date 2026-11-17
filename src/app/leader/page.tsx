import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicHandle } from "@/lib/public-handle";
import type { PermissionKey } from "@/modules/admin/permissions";

export const metadata = { title: "Leader workshop" };
export const dynamic = "force-dynamic";

/**
 * /leader: the Advocate Leader's home base. Shows only the tools this person
 * can actually open (their effective permissions), and the people they
 * brought in.
 *
 * Recruits are members whose profiles.referrer_id is this leader (Field
 * signup and the personal invite link both stamp it). profiles RLS lets only
 * the owner read other members' rows (0310), so the read is service-role
 * AFTER the leader check, and recruits appear by @username only: a leader
 * never sees a recruit's real name here.
 */
type Tool = { href: string; title: string; body: string; need?: PermissionKey };

const TOOLS: Tool[] = [
  { href: "/admin/campaigns/new", need: "author_campaigns", title: "✍️ Write a campaign",
    body: "A call to action for any state. An admin checks it before it goes live." },
  { href: "/admin/campaigns", need: "author_campaigns", title: "📣 Your campaigns and waves",
    body: "Edit what you wrote, see who acted, and schedule a wave once a campaign is live." },
  { href: "/admin/locals", need: "add_local_officials", title: "🏛 Add local officials",
    body: "City and county officials your area's campaigns should reach." },
  { href: "/admin/forum", need: "moderate_forum", title: "💬 Forum queue",
    body: "Approve held posts and hide spam and abuse." },
  { href: "/admin/moderation", need: "moderate_forum", title: "🚩 Reports",
    body: "What members reported in groups, photos and walls." },
  { href: "/admin/stories", need: "moderate_stories", title: "📖 Story submissions",
    body: "Approve members' stories so others can add them to their letters." },
  { href: "/account/invite", title: "🔗 Your invite link and QR code",
    body: "Anyone who joins through it counts as your recruit." },
  { href: "/coalitions", title: "👥 Run a group",
    body: "Events and call-in days, district captains, pinned letter templates and the group badge." },
];

export default async function LeaderPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard?need=leader");

  const sr = createServiceRoleClient();
  const [{ count }, { data: recent }] = await Promise.all([
    sr.from("profiles").select("id", { count: "exact", head: true }).eq("referrer_id", ctx.userId),
    sr.from("profiles").select("id, created_at, username, state").eq("referrer_id", ctx.userId)
      .order("created_at", { ascending: false }).limit(5),
  ]);
  const recruits = (recent ?? []) as Array<{ id: string; created_at: string; username: string | null; state: string | null }>;
  const acted = new Set<string>();
  if (recruits.length > 0) {
    const { data: acts } = await sr.from("campaign_actions").select("user_id")
      .in("user_id", recruits.map((r) => r.id)).limit(200);
    for (const a of (acts ?? []) as { user_id: string }[]) acted.add(a.user_id);
  }

  const can = new Set<string>(ctx.permissions);
  const tools = TOOLS.filter((t) => !t.need || can.has(t.need));

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          {ctx.isOwner ? "Owner" : ctx.isAdmin ? "Admin" : "Advocate Leader"}
        </p>
        <h1 className="mt-2 text-3xl font-bold">Leader workshop</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Tools for the people doing the hands-on work: booths, shop visits, hearing rooms and a lot of
          letters. Thank you for doing it.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-emerald-700/40 bg-emerald-950/10 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">📊 Your recruits</p>
            <p className="mt-1 text-3xl font-bold">{(count ?? 0).toLocaleString()}</p>
          </div>
          <span className="text-xs text-zinc-500">people you brought in</span>
        </div>
        {recruits.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm">
            {recruits.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-zinc-300">
                <span className="font-mono text-[10px] text-zinc-500">{new Date(r.created_at).toLocaleDateString()}</span>
                <span>{publicHandle(r)}</span>
                {acted.has(r.id) && <span className="rounded bg-emerald-950/50 px-1.5 text-[10px] text-emerald-300">took action</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-zinc-500">
            No recruits yet. Sign someone up at your next event, or share your invite link.
          </p>
        )}
      </section>

      <a
        href="/leader/field-signup"
        className="mb-4 block rounded-lg border border-emerald-500 bg-emerald-950/20 p-5 transition hover:border-emerald-400 hover:bg-emerald-950/30"
      >
        <h2 className="text-lg font-semibold">📍 Field signup</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Sign someone up in 30 seconds at a booth or event: email, first name and ZIP on your phone. They
          get a link to finish on their own device. Unlocks once you&apos;ve agreed to the leader rules.
        </p>
      </a>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <a key={t.href} href={t.href} className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 transition hover:border-emerald-500">
            <h3 className="text-base font-semibold">{t.title}</h3>
            <p className="mt-1 text-sm text-zinc-400">{t.body}</p>
          </a>
        ))}
      </div>

      <p className="mt-8 text-xs text-zinc-500">
        What leaders can and can&apos;t do is on <a href="/how-it-works/roles" className="underline hover:text-emerald-400">Roles and badges</a>.
        Missing a tool? Tell us with the Feedback button.
      </p>
    </div>
  );
}
