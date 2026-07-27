import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { SyncStateButton } from "./SyncStateButton";

export const metadata = { title: "Admin · Legislators" };

const STATUS_BADGE: Record<string, string> = {
  legal: "bg-emerald-950/40 text-emerald-300",
  kcpa: "bg-blue-950/40 text-blue-300",
  banned: "bg-red-950/40 text-red-300",
  restricted: "bg-amber-950/40 text-amber-300",
};

export default async function AdminLegislatorsPage() {
  const ctx = await getAdminContext({ require: "edit_legislators" });
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();

  // Get states + per-state legislator counts + most-recent sync time
  const { data: states } = await supabase
    .from("states")
    .select("abbr, name, kratom_status")
    .order("abbr");

  const { data: rows } = await supabase
    .from("legislators")
    .select("state, last_synced_at");

  const byState = new Map<string, { count: number; lastSynced: string | null }>();
  for (const s of states ?? []) byState.set(s.abbr, { count: 0, lastSynced: null });
  for (const r of rows ?? []) {
    const cur = byState.get(r.state) ?? { count: 0, lastSynced: null };
    cur.count++;
    if (r.last_synced_at && (!cur.lastSynced || r.last_synced_at > cur.lastSynced)) {
      cur.lastSynced = r.last_synced_at;
    }
    byState.set(r.state, cur);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Legislators</h1>
        <p className="mt-2 text-sm text-zinc-400">
          State legislators synced from OpenStates. Click a state to re-sync. For batch
          sync of all 50 states, run{" "}
          <code className="rounded bg-zinc-900 px-2 py-0.5 text-xs">
            npm run sync:legislators
          </code>{" "}
          locally.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          U.S. Senate / House sync requires LegiScan or ProPublica Congress API — coming
          when those keys are in.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="p-3 text-left">State</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Synced</th>
              <th className="p-3 text-left">Last sync</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {(states ?? []).map((s) => {
              const v = byState.get(s.abbr) ?? { count: 0, lastSynced: null };
              return (
                <tr key={s.abbr}>
                  <td className="p-3">
                    <span className="font-mono text-xs text-zinc-500">{s.abbr}</span>
                    <span className="ml-3">{s.name}</span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        STATUS_BADGE[s.kratom_status ?? ""] ?? "bg-zinc-900 text-zinc-500"
                      }`}
                    >
                      {s.kratom_status ?? "unknown"}
                    </span>
                  </td>
                  <td className="p-3 text-right font-mono">
                    {v.count > 0 ? v.count : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="p-3 text-xs text-zinc-500">
                    {v.lastSynced
                      ? new Date(v.lastSynced).toLocaleString()
                      : <span className="text-zinc-700">never</span>}
                  </td>
                  <td className="p-3 text-right">
                    <SyncStateButton state={s.abbr} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
