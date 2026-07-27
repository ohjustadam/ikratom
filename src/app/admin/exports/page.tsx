import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";

export const metadata = { title: "Data exports" };

const EXPORTS = [
  { type: "campaigns", label: "Campaigns", desc: "All campaigns with state, scope, status, review_state. Useful for partner reporting.", ownerOnly: false },
  { type: "actions", label: "Campaign actions", desc: "Every email/call ever logged. Method, timestamp, referrer (which embed widget drove it).", ownerOnly: false },
  { type: "advocates", label: "Advocates", desc: "All registered users (no email — real names + matched districts + role flags + streak data). Use for partnership reach analysis.", ownerOnly: true },
  { type: "bills", label: "Bills", desc: "Every active bill we track with stance, deep-analysis flags, signed/effective dates, official source URL.", ownerOnly: false },
] as const;

export default async function ExportsPage() {
  const ctx = await getCreatorContext({ require: "view_admin_dashboard" });
  if (!ctx.ok) redirect("/dashboard");

  // The advocates dump is owner-tier (see the route). Hide it outright for
  // everyone else rather than showing a button that 403s.
  const exports = EXPORTS.filter((e) => !e.ownerOnly || ctx.isOwner);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Data exports</h1>
        <p className="mt-2 text-sm text-zinc-400">
          CSV downloads of platform data. Useful for partner reporting,
          monthly summaries to org boards, or just spreadsheet sanity-checks.
        </p>
      </header>

      <ul className="space-y-3">
        {exports.map((e) => (
          <li key={e.type} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-zinc-100">{e.label}</h3>
              <a
                href={`/api/admin/exports?type=${e.type}`}
                download
                className="ml-auto rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
              >
                Download CSV →
              </a>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{e.desc}</p>
          </li>
        ))}
      </ul>

      <p className="mt-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-xs text-zinc-500">
        Exports are gated on admin / owner / advocate-leader role server-side
        — anyone else gets a 403. The Advocates export is owner-only, since it
        pairs real names with resolved districts. Every download is written to{" "}
        <a href="/admin/audit" className="underline hover:text-emerald-400">/admin/audit</a>{" "}
        with the type and row count.
      </p>
    </div>
  );
}
