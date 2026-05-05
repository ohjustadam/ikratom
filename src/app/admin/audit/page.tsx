import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Admin · Audit log" };

export default async function AuditLogPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("admin_audit_log")
    .select("id, actor_id, actor_email, action, target_type, target_id, details, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Audit log</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Record of sensitive admin actions. Last 200 entries.
        </p>
      </header>

      {(rows ?? []).length === 0 ? (
        <p className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No actions logged yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="p-3 text-left">When</th>
                <th className="p-3 text-left">Actor</th>
                <th className="p-3 text-left">Action</th>
                <th className="p-3 text-left">Target</th>
                <th className="p-3 text-left">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
              {(rows ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="p-3 text-xs text-zinc-500">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs">
                    <span className="text-zinc-300">{r.actor_email ?? "—"}</span>
                  </td>
                  <td className="p-3">
                    <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs">
                      {r.action}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-zinc-400">
                    {r.target_type ? (
                      <>
                        {r.target_type}
                        {r.target_id && (
                          <>: <span className="font-mono text-[10px] text-zinc-600">{r.target_id.slice(0, 8)}</span></>
                        )}
                      </>
                    ) : "—"}
                  </td>
                  <td className="p-3">
                    {r.details ? (
                      <code className="text-[10px] text-zinc-500">{JSON.stringify(r.details)}</code>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
