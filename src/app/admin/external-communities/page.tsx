import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listAllExternalCommunities } from "@/modules/external-communities/actions";
import { ExternalCommunitiesPanel } from "./ExternalCommunitiesPanel";

export const metadata = { title: "External communities" };
export const dynamic = "force-dynamic";

export default async function AdminExternalCommunitiesPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listAllExternalCommunities();
  const rows = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">External communities</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Third-party places kratom advocates already gather — Facebook groups,
            subreddits, Discord servers, podcasts. Edits here update{" "}
            <a href="/communities" className="text-emerald-400 hover:underline">/communities</a>{" "}
            instantly.
          </p>
        </div>
      </header>

      <div className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
        <p className="font-semibold text-zinc-200">Per-row actions:</p>
        <ul className="mt-2 space-y-1">
          <li><span className="font-mono text-zinc-300">Edit</span> — update name / URL / description / category / sort order inline.</li>
          <li><span className="font-mono text-amber-300">Archive</span> — hides from /communities. Reversible.</li>
          <li><span className="font-mono text-red-300">Delete forever</span> — permanent. Type the name to confirm.</li>
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
          For internal iKratom topical communities (Veterans, Shop owners, etc.), see{" "}
          <a href="/admin/communities" className="hover:text-emerald-400">/admin/communities</a>.
        </p>
      </div>

      <ExternalCommunitiesPanel initial={rows} />
    </div>
  );
}
