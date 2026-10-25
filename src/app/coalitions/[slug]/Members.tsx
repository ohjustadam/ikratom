import { handleInitial } from "@/modules/coalitions/covers";

/**
 * The group's member list (members only). @handles only, via publicHandle()
 * upstream: never a real name, even to fellow members.
 */
export type MemberView = { user_id: string; role: string; joined_at: string; handle: string; avatarUrl: string | null };

const ROLE_LABEL: Record<string, string> = { owner: "Organizer", admin: "Admin", member: "Member" };

export function Members({ members }: { members: MemberView[] }) {
  return (
    <section id="members" className="mb-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">Members ({members.length})</h2>
      <ul className="divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/40">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-700 text-sm font-bold text-zinc-100">
              {m.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={m.avatarUrl} alt="" width={36} height={36} loading="lazy" className="h-full w-full object-cover" />
                : handleInitial(m.handle)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-100">{m.handle}</span>
              <span className="text-[11px] text-zinc-500">Joined {new Date(m.joined_at).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
            </span>
            {m.role !== "member" && (
              <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${m.role === "owner" ? "bg-amber-500 text-zinc-950" : "bg-emerald-700 text-zinc-100"}`}>
                {ROLE_LABEL[m.role] ?? m.role}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
