import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Admin · Campaigns" };

export default async function AdminCampaignsPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, slug, title, state, active, created_at")
    .order("active", { ascending: false })
    .order("state", { ascending: true, nullsFirst: false })
    .order("title");

  // action counts
  const ids = (campaigns ?? []).map((c) => c.id);
  const counts: Record<string, number> = {};
  if (ids.length > 0) {
    const { data: rows } = await supabase
      .from("campaign_actions")
      .select("campaign_id")
      .in("campaign_id", ids);
    for (const r of rows ?? []) counts[r.campaign_id] = (counts[r.campaign_id] ?? 0) + 1;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="mt-1 text-sm text-zinc-400">
            {(campaigns ?? []).length} total ·{" "}
            {(campaigns ?? []).filter((c) => c.active).length} active
          </p>
        </div>
        <a
          href="/admin/campaigns/new"
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          + New campaign
        </a>
      </header>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="p-3 text-left">State</th>
              <th className="p-3 text-left">Title</th>
              <th className="p-3 text-left">Slug</th>
              <th className="p-3 text-right">Actions</th>
              <th className="p-3 text-center">Status</th>
              <th className="p-3 text-right">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {(campaigns ?? []).map((c) => (
              <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                <td className="p-3">
                  {c.state ? (
                    <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs">{c.state}</span>
                  ) : (
                    <span className="rounded bg-purple-950/40 px-2 py-0.5 text-xs text-purple-300">Federal</span>
                  )}
                </td>
                <td className="p-3 max-w-md truncate">{c.title}</td>
                <td className="p-3 font-mono text-xs text-zinc-500">{c.slug}</td>
                <td className="p-3 text-right font-mono">{counts[c.id] ?? 0}</td>
                <td className="p-3 text-center">
                  {c.active ? (
                    <span className="rounded bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-300">Active</span>
                  ) : (
                    <span className="rounded bg-zinc-900 px-2 py-0.5 text-xs text-zinc-500">Archived</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <a
                    href={`/admin/campaigns/${c.id}/edit`}
                    className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs hover:border-emerald-500"
                  >
                    Edit
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
