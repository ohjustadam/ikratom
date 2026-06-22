import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPendingCoverageRequests } from "@/modules/local-reps/actions";
import { RejectButton } from "./RejectButton";
import { LocalRepRequestRow } from "./LocalRepRequestRow";
import { ResolveQueueButton } from "./ResolveQueueButton";

/**
 * /admin/local-rep-requests — queue of user-requested local rep coverage.
 *
 * 2026-05-17: refactored to inline AI suggest. Clicking "AI suggest"
 * on a row no longer routes away — it expands a panel showing the AI's
 * suggestions with verification tier (verified / tentative / rejected)
 * + per-official accept checkboxes. Multiple rows can be expanded at
 * once. The legacy bulk /admin/locals/suggest still exists for power
 * sessions where admin wants the full form.
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
          Areas where users have asked us to add local reps. Click{" "}
          <strong>AI suggest</strong> on any row to expand a panel inline — review the
          AI&apos;s suggestions, click the source URLs to spot-check, tick the boxes
          for officials to accept, and save. The request closes automatically and
          waiting users get a notification. No page reroute, no context loss.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          🤖 The weekly cron also auto-fulfills these (Sundays 8am UTC) using the
          same flow + source verification. Anything still here is something the
          automation rejected or hasn&apos;t reached yet.{" "}
          <a href="/admin/locals/suggest" className="text-zinc-400 hover:text-emerald-400">
            Legacy bulk-suggest page →
          </a>
        </p>
        <ResolveQueueButton />
      </header>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          Queue is empty.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <LocalRepRequestRow
              key={`${row.state}::${row.locality}::${row.level}`}
              request={{
                state: row.state,
                locality: row.locality,
                level: row.level as "municipal" | "county",
                user_count: row.user_count,
              }}
              rejectButton={
                <RejectButton
                  state={row.state}
                  locality={row.locality}
                  level={row.level as "municipal" | "county"}
                />
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
