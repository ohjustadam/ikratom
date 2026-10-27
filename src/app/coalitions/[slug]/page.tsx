import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { getGroupLink } from "@/modules/coalitions/growth-actions";
import { groupBadge, type WinsRow } from "@/modules/coalitions/home";
import { About } from "./About";
import { Discussion } from "./Discussion";
import { Events } from "./Events";
import { GroupAction, JoinRequests } from "./GroupGrowth";
import { GroupLinkCard, RequestToJoin } from "./GroupGrowthClient";
import { GroupHeader, type GroupTab } from "./GroupHeader";
import { Coverage } from "./Coverage";
import { Leaderboard } from "./Leaderboard";
import { Members, type MemberView } from "./Members";
import { Resources } from "./Resources";
import { TeamActivity } from "./TeamActivity";
import { Welcome } from "./Welcome";
import { Wins } from "./Wins";

/**
 * A group's home, laid out like a familiar social group (owner ask
 * 2026-10-24, for the first community): cover, name, members, one-tap Invite,
 * then Home (checklist, group action, wins, events, the board), Events,
 * Members and About tabs. Phone first. Members only, except a public group's
 * landing view (About, wins, "Ask to join"). Identity is @handle only.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;
type Role = "owner" | "admin" | "member";

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb.from("coalitions").select("name, description, is_public").eq("slug", slug).maybeSingle();
  if (!data) return { title: "Group" };
  return {
    title: data.name as string,
    description: (data.description as string | null) ?? undefined,
    robots: data.is_public ? undefined : { index: false },
  };
}

export default async function CoalitionDetailPage({ params, searchParams }: {
  params: Params; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: row } = await sb
    .from("coalitions")
    .select("id, slug, name, description, state, is_public, owner_id, created_at, featured_campaign_id, featured_set_at, cover_theme")
    .eq("slug", slug).maybeSingle();
  if (!row) notFound();
  const c = row as {
    id: string; slug: string; name: string; description: string | null; state: string | null; is_public: boolean;
    owner_id: string; created_at: string; featured_campaign_id: string | null; featured_set_at: string | null; cover_theme: string | null;
  };

  let viewerRole: Role | null = null;
  if (user) {
    const { data } = await sb.from("coalition_members").select("role").eq("coalition_id", c.id).eq("user_id", user.id).maybeSingle();
    viewerRole = (data?.role as Role | undefined) ?? null;
  }
  // A private group doesn't exist for anyone outside it.
  if (!c.is_public && !viewerRole) notFound();
  const isOrganizer = viewerRole === "owner" || viewerRole === "admin";

  // Members (RLS returns rows to members only). @handle via get_public_profiles, never a real name.
  let members: MemberView[] = [];
  if (viewerRole) {
    const { data: rows } = await sb.from("coalition_members").select("user_id, role, joined_at")
      .eq("coalition_id", c.id).order("joined_at", { ascending: true });
    const list = (rows ?? []) as { user_id: string; role: string; joined_at: string }[];
    const prof = new Map<string, { username: string | null; state: string | null; avatar_url: string | null }>();
    if (list.length > 0) {
      const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: list.map((r) => r.user_id) });
      for (const p of (profs ?? []) as { id: string; username: string | null; state: string | null; avatar_url: string | null }[]) prof.set(p.id, p);
    }
    members = list.map((r) => {
      const p = prof.get(r.user_id);
      return { ...r, handle: publicHandle({ username: p?.username ?? null, state: p?.state ?? null }), avatarUrl: p?.avatar_url ?? null };
    });
  }

  // Wins: members, plus signed-in visitors of a public group (counts only).
  const { data: winsData } = user ? await sb.rpc("coalition_wins", { p_coalition_id: c.id }) : { data: null };
  const wins = (Array.isArray(winsData) ? winsData[0] : null) as WinsRow | null;
  const memberCount = viewerRole ? members.length : (wins?.members_total ?? null);

  // The group link, fetched up front so Invite opens the share sheet in one
  // tap. An organizer's first visit turns it on (one reusable link per group).
  const link = viewerRole ? await getGroupLink(c.id) : null;

  const tabParam = typeof sp.tab === "string" ? sp.tab : "home";
  const tab: GroupTab = viewerRole && ["events", "members", "about"].includes(tabParam) ? (tabParam as GroupTab) : "home";

  // The welcome checklist's one-tap shortcuts: ?intro=1 a pre-filled hello,
  // ?welcome=1 an organizer's pinned welcome post, ?plan=1 the event form.
  const { data: featuredCamp } = c.featured_campaign_id && viewerRole
    ? await sb.from("campaigns").select("id, slug, active").eq("id", c.featured_campaign_id).maybeSingle()
    : { data: null };
  const featured = featuredCamp?.active ? { id: featuredCamp.id as string, slug: featuredCamp.slug as string, set_at: c.featured_set_at } : null;
  const myHandle = members.find((m) => m.user_id === user?.id)?.handle ?? "";
  const prefill = sp.welcome === "1" && isOrganizer
    ? { title: "👋 Welcome! Start here", body: welcomeBody(c.name), pin: true }
    : sp.intro === "1"
      ? { title: `👋 Hi, I'm ${myHandle}`, body: "Hi everyone! I live in ___ and kratom matters to me because ___.\n\nI can help by ___." }
      : null;

  const invite = viewerRole && (
    <div id="invite" className="scroll-mt-20">
      <GroupLinkCard coalitionId={c.id} groupName={c.name} initial={link?.ok ? { url: link.url, qrSvg: link.qrSvg } : null} />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-6 sm:pt-6">
      <GroupHeader
        group={c}
        memberCount={memberCount}
        faces={members.slice(0, 7).map((m) => ({ handle: m.handle, avatarUrl: m.avatarUrl }))}
        viewerRole={viewerRole}
        tab={tab}
        showTabs={!!viewerRole}
        link={{ url: link?.ok ? link.url : null, error: link && !link.ok ? link.error : null }}
        badge={wins ? groupBadge(wins.letters_total) : null}
      />

      {!viewerRole && (
        <>
          {c.description && <p className="mb-6 whitespace-pre-wrap text-sm text-zinc-300">{c.description}</p>}
          {wins && <Wins w={wins} />}
          {user && !viewerRole && c.is_public && <RequestToJoin coalitionId={c.id} />}
          {!user && (
            <p className="rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-sm text-amber-200">
              💡 <Link href={`/login?redirect=${encodeURIComponent(`/coalitions/${c.slug}`)}`} className="font-semibold underline">Sign in or create a free account</Link> to ask to join this group.
            </p>
          )}
        </>
      )}

      {viewerRole && user && tab === "home" && (
        <>
          <Welcome coalitionId={c.id} slug={c.slug} userId={user.id} isOrganizer={isOrganizer} featuredCampaign={featured} />
          {isOrganizer && <JoinRequests coalitionId={c.id} />}
          <GroupAction coalitionId={c.id} state={c.state} isAdmin={isOrganizer} />
          <Resources coalitionId={c.id} slug={c.slug} isOrganizer={isOrganizer} userId={user.id} />
          {wins && <Wins w={wins} />}
          <Events coalitionId={c.id} slug={c.slug} isAdmin={isOrganizer} limit={3} openForm={sp.plan === "1"} />
          {viewerRole && <Discussion coalitionId={c.id} slug={c.slug} prefill={prefill} />}
          {invite}
        </>
      )}

      {viewerRole && tab === "events" && (
        <Events coalitionId={c.id} slug={c.slug} isAdmin={isOrganizer} limit={30} openForm={sp.plan === "1"} />
      )}

      {viewerRole && tab === "members" && (
        <>
          {invite}
          <Members members={members} />
          {user && (
            <Coverage coalitionId={c.id} slug={c.slug} state={c.state} isOrganizer={isOrganizer} userId={user.id}
              chamber={typeof sp.chamber === "string" ? sp.chamber : undefined}
              members={members.map((m) => ({ user_id: m.user_id, handle: m.handle }))} />
          )}
          {user && <Leaderboard coalitionId={c.id} slug={c.slug} userId={user.id} lettersTotal={wins?.letters_total ?? 0} />}
          <TeamActivity coalitionId={c.id} />
        </>
      )}

      {viewerRole && tab === "about" && <About group={c} memberCount={memberCount} viewerRole={viewerRole} />}
    </div>
  );
}

/** The organizer's pinned welcome post, pre-filled from the checklist; they edit it before posting. */
function welcomeBody(name: string): string {
  return [
    `Welcome to ${name}! Reply below to introduce yourself: where you live, and why kratom matters to you.`,
    "How we work:",
    "• Each week we pick one group action. It takes about a minute.",
    "• Call-in days and meetings are under Events. RSVP and you'll get a reminder.",
    "• Share the group link with one person you trust.",
    "Everyone here appears by @username only.",
  ].join("\n\n");
}
