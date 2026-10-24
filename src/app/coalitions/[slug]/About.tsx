import { StateIntel } from "./StateIntel";
import { VisibilityToggle } from "./GroupGrowthClient";
import { AboutEditor, LeaveGroup } from "./GroupHomeClient";

/** The group's About tab: what it's for, the facts, and the organizers' settings. */
export function About({ group, memberCount, viewerRole }: {
  group: { id: string; description: string | null; state: string | null; is_public: boolean; created_at: string; cover_theme: string | null };
  memberCount: number | null;
  viewerRole: "owner" | "admin" | "member" | null;
}) {
  const isOrganizer = viewerRole === "owner" || viewerRole === "admin";
  return (
    <>
      <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <h2 className="text-sm font-bold text-zinc-200">About this group</h2>
        {group.description
          ? <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">{group.description}</p>
          : <p className="mt-2 text-sm text-zinc-500">{isOrganizer ? "Tell people what this group is for and what you're working on." : "No description yet."}</p>}
        <ul className="mt-4 space-y-2 text-sm text-zinc-300">
          <li>{group.is_public
            ? "🌐 Public: anyone signed in can find the group and ask to join. Only members see the board, events and member list."
            : "🔒 Private: only members can see this group. People join with the group link."}</li>
          {group.state && <li>📍 {group.state}</li>}
          {memberCount !== null && <li>👥 {memberCount} member{memberCount === 1 ? "" : "s"}</li>}
          <li>🗓 Started {new Date(group.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</li>
          <li>🕶 Everyone appears by @username. Real names and emails are never shown.</li>
        </ul>
        {isOrganizer && <div className="mt-4"><AboutEditor coalitionId={group.id} description={group.description} coverTheme={group.cover_theme} /></div>}
      </section>

      {group.state && viewerRole && <StateIntel state={group.state} />}

      {isOrganizer && <VisibilityToggle coalitionId={group.id} isPublic={group.is_public} />}

      {viewerRole && viewerRole !== "owner" && <div className="mb-6"><LeaveGroup coalitionId={group.id} /></div>}
    </>
  );
}
