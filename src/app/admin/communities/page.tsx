import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listAllCommunities } from "@/modules/forum/community-actions";
import { CommunitiesPanel } from "./CommunitiesPanel";

export const metadata = { title: "Communities" };

export default async function AdminCommunitiesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listAllCommunities();
  const rows = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Communities</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Topical communities that sit alongside the state forums — Veterans, Shop owners,
          Caregivers, etc. Each gets its own /forum/c/&lt;slug&gt; page. Threads can opt
          into a community when authored.
        </p>
      </header>

      <div className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">Admin actions per community:</p>
        <ul className="mt-2 space-y-1">
          <li><span className="font-mono text-zinc-300">Edit</span> — change slug / name / icon / description / sort order inline.</li>
          <li><span className="font-mono text-amber-300">Archive</span> — soft delete. Hides from /forum + 404s the public slug, but the row stays so existing threads keep their tag. Reversible via <span className="font-mono">Restore</span>.</li>
          <li><span className="font-mono text-red-300">Delete forever</span> — permanent. Existing threads survive (FK is ON DELETE SET NULL) but lose their community tag. Requires typing the slug to confirm.</li>
        </ul>
      </div>

      <CommunitiesPanel initial={rows} />
    </div>
  );
}
