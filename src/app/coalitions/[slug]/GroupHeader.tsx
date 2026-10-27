import Link from "@/components/Link";
import { coverClass, handleInitial } from "@/modules/coalitions/covers";
import { InviteButton } from "./GroupHomeClient";

/**
 * The top of a group's home, laid out like a familiar social-group page:
 * cover banner, name, privacy and member count, a row of member faces
 * (@handle initials only), and the one-tap Invite. Then the tab bar.
 */

export type GroupTab = "home" | "chat" | "events" | "members" | "about";
const TABS: { key: GroupTab; label: string }[] = [
  { key: "home", label: "Home" },
  { key: "chat", label: "💬 Chat" },
  { key: "events", label: "Events" },
  { key: "members", label: "Members" },
  { key: "about", label: "About" },
];

export function GroupHeader({ group, memberCount, faces, viewerRole, tab, showTabs, link }: {
  group: { id: string; slug: string; name: string; state: string | null; is_public: boolean; cover_theme: string | null };
  memberCount: number | null;
  faces: { handle: string; avatarUrl: string | null }[];
  viewerRole: "owner" | "admin" | "member" | null;
  tab: GroupTab;
  showTabs: boolean;
  link: { url: string | null; error: string | null };
}) {
  const isOrganizer = viewerRole === "owner" || viewerRole === "admin";
  return (
    <header className="mb-4">
      <div className={`relative h-32 overflow-hidden rounded-b-2xl sm:h-44 sm:rounded-2xl ${coverClass(group.cover_theme)}`}>
        <span aria-hidden className="absolute -bottom-6 right-3 select-none text-[7rem] font-black leading-none text-white/10 sm:text-[9rem]">
          {group.state ?? "US"}
        </span>
        <span aria-hidden className="absolute left-4 top-3 text-3xl drop-shadow">🍃</span>
      </div>

      <div className="px-1 pt-3">
        <h1 className="text-2xl font-bold leading-tight text-zinc-50 sm:text-3xl">{group.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {group.is_public ? "🌐 Public group" : "🔒 Private group"}
          {memberCount !== null && <> · <strong className="text-zinc-200">{memberCount}</strong> member{memberCount === 1 ? "" : "s"}</>}
          {group.state && <> · {group.state}</>}
          {viewerRole && viewerRole !== "member" && (
            <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] uppercase ${viewerRole === "owner" ? "bg-amber-500 text-zinc-950" : "bg-emerald-700 text-zinc-100"}`}>
              {viewerRole === "owner" ? "Organizer" : "Admin"}
            </span>
          )}
        </p>

        {faces.length > 0 && (
          <div className="mt-3 flex items-center">
            <ul className="flex -space-x-2" aria-label="Some of the members">
              {faces.slice(0, 7).map((f) => (
                <li key={f.handle} title={f.handle}
                  className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-zinc-950 bg-zinc-700 text-xs font-bold text-zinc-100">
                  {f.avatarUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={f.avatarUrl} alt="" width={32} height={32} loading="lazy" className="h-full w-full object-cover" />
                    : handleInitial(f.handle)}
                </li>
              ))}
            </ul>
            {memberCount !== null && memberCount > 7 && <span className="ml-2 text-xs text-zinc-400">+{memberCount - 7} more</span>}
          </div>
        )}

        {viewerRole && (
          <div className="mt-3 flex gap-2">
            <InviteButton coalitionId={group.id} groupName={group.name} shareUrl={link.url} unavailable={link.error} />
            {isOrganizer && (
              <Link href={`/coalitions/${group.slug}?plan=1#events`}
                className="flex min-h-11 flex-1 items-center justify-center rounded-md border border-zinc-700 px-3 text-sm font-semibold text-zinc-200 hover:border-emerald-500 sm:flex-none">
                📅 Plan event
              </Link>
            )}
          </div>
        )}
      </div>

      {showTabs && (
        <nav aria-label="Group sections" className="-mx-4 mt-4 border-b border-zinc-800 px-4 sm:mx-0 sm:px-0">
          <ul className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => (
              <li key={t.key}>
                <Link href={tabHref(group.slug, t.key)}
                  aria-current={tab === t.key ? "page" : undefined}
                  className={`flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${
                    tab === t.key ? "border-emerald-400 text-emerald-300" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}>
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}

/** Chat is its own page (a full-height room on a phone); the rest are tabs of the group home. */
function tabHref(slug: string, key: GroupTab): string {
  if (key === "home") return `/coalitions/${slug}`;
  if (key === "chat") return `/coalitions/${slug}/chat`;
  return `/coalitions/${slug}?tab=${key}`;
}
