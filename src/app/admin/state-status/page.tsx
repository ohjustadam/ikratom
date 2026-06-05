import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listStateStatus } from "@/modules/state-status/actions";
import { StateStatusRow } from "./StateStatusRow";

export const metadata = { title: "State status · Admin" };
export const dynamic = "force-dynamic";

/**
 * /admin/state-status — Mission Control confirm queue. States flagged
 * needs_review (statute-only bans, pending-only signals, KCPA 7-OH
 * inference) sort to the top. Admins set the canonical admin_* status,
 * which the /states/[code] header prefers over the auto-derived value.
 */
export default async function AdminStateStatusPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const r = await listStateStatus();
  const rows = "ok" in r ? r.rows : [];
  const flagged = rows.filter((row) => row.needs_review);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-zinc-100">
      <h1 className="text-2xl font-bold">State status</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Canonical per-state kratom + 7-OH legality. Auto-derived nightly from
        enacted state bills; confirm or override the flagged ones (naive
        derivation is unreliable for statute-only bans and KCPA edge cases).
      </p>

      {"error" in r && <p className="mt-4 text-red-400">{r.error}</p>}

      {rows.length === 0 ? (
        <div className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 text-sm text-zinc-400">
          No derived state status yet. Apply migration 0173 (<code className="text-emerald-300">npm run db:push</code>)
          then run <code className="text-emerald-300">npm run derive:state-status -- --apply</code> (or wait for the daily cron).
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-zinc-500">
            {flagged.length} of {rows.length} need review.
          </p>
          <ul className="mt-4 space-y-3">
            {rows.map((row) => (
              <StateStatusRow key={row.state} row={row} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
