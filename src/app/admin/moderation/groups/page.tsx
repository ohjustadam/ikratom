import { redirect } from "next/navigation";
import Link from "@/components/Link";
import { getAdminContext } from "@/modules/admin/actions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { publicHandle } from "@/lib/public-handle";
import { GroupListingActions } from "./GroupListingActions";

export const metadata = { title: "Groups waiting" };
export const dynamic = "force-dynamic";

/**
 * /admin/moderation/groups — new public groups waiting to be listed (migration
 * 0313). A waiting group is private, so its page 404s for a moderator who isn't
 * a member: everything a visitor would see is shown here instead.
 */
export default async function GroupsWaitingPage() {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) redirect("/dashboard");

  const svc = createServiceRoleClient();
  const { data } = await svc.from("coalitions")
    .select("id, name, description, state, owner_id, listing_requested_at")
    .not("listing_requested_at", "is", null).is("listing_approved_at", null)
    .order("listing_requested_at").limit(60);
  const groups = (data ?? []) as { id: string; name: string; description: string | null; state: string | null; owner_id: string; listing_requested_at: string }[];

  const owners = [...new Set(groups.map((g) => g.owner_id))];
  const { data: profiles } = owners.length ? await svc.from("profiles").select("id, username, state").in("id", owners) : { data: [] };
  const who = new Map(((profiles ?? []) as { id: string; username: string | null; state: string | null }[]).map((p) => [p.id, p]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin/moderation" className="text-xs text-zinc-500 hover:text-emerald-400">← Moderation</Link>
      <h1 className="mt-2 text-3xl font-bold">Groups waiting to be listed</h1>
      <p className="mt-2 text-sm text-zinc-400">Approve lists the group in the public directory. Decline keeps it private and working, and tells the organizer to check the wording.</p>
      {groups.length === 0 && <p className="mt-6 rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4 text-sm text-emerald-300">✓ No groups waiting.</p>}
      <ul className="mt-6 space-y-4">
        {groups.map((g) => (
          <li key={g.id} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 text-sm">
            <p>
              <span className="text-lg font-semibold text-zinc-100">{g.name}</span>
              <span className="ml-2 text-xs text-zinc-500">
                {g.state ?? "National"} · by <a href={`/profile/${g.owner_id}`} className="text-emerald-400 hover:underline">{publicHandle(who.get(g.owner_id))}</a> · asked {new Date(g.listing_requested_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </p>
            {g.description
              ? <p className="whitespace-pre-wrap text-zinc-300">{g.description}</p>
              : <p className="text-zinc-500">No About text.</p>}
            <GroupListingActions coalitionId={g.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}
