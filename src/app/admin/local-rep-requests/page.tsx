import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPendingCoverageRequests } from "@/modules/local-reps/actions";
import { RejectButton } from "./RejectButton";

/**
 * /admin/local-rep-requests — queue of user-requested local rep coverage
 * by area. Each row is a (state, locality, level) tuple with the count
 * of users waiting. Admin clicks "AI suggest" which links to the
 * existing /admin/locals/suggest flow pre-filled with the locality.
 *
 * When the admin accepts suggestions there, the existing
 * acceptSuggestions hook automatically fulfills the matching request
 * rows + fans out notifications to waiting users.
 */
export const metadata = { title: "Local rep requests" };

export default async function LocalRepRequestsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listPendingCoverageRequests();
  const rows = "ok" in r && r.rows ? r.rows : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Local rep requests</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Areas where users have asked us to add local reps. Click <strong>AI suggest</strong> to
          run the discovery flow pre-filled with the area. When you accept suggestions
          there, the request closes automatically and waiting users get a notification.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          Queue is empty.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const suggestHref = `/admin/locals/suggest?city=${encodeURIComponent(r.locality)}&state=${r.state}`;
            return (
              <li
                key={`${r.state}::${r.locality}::${r.level}`}
                className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-4"
              >
                <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                  {r.state}
                </span>
                <span className="font-semibold text-zinc-100">{r.locality}</span>
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
                  {r.level}
                </span>
                <span className="text-xs text-zinc-500">
                  {r.user_count} {r.user_count === 1 ? "user waiting" : "users waiting"}
                </span>
                <span className="ml-auto flex gap-2">
                  <a
                    href={suggestHref}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs hover:border-emerald-500"
                  >
                    AI suggest →
                  </a>
                  <RejectButton state={r.state} locality={r.locality} level={r.level as "municipal" | "county"} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
