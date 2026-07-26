import { redirect } from "next/navigation";
import Link from "next/link";
import { getAdminContext } from "@/modules/admin/actions";
import { queueCounts } from "@/modules/admin/queue-resolve-actions";
import ResolveQueue from "@/app/admin/_components/ResolveQueue";
import type { QueueKind } from "@/modules/admin/queue-resolve-types";

export const metadata = { title: "Moderation" };
export const dynamic = "force-dynamic";

/**
 * /admin/moderation — one home for every review queue.
 *
 * Deliberately generic: each queue is a config entry (kind + copy + link), so
 * this panel white-labels to other advocacy verticals — add a queue to QUEUES
 * and it renders with the same one-click autonomy. "Auto-resolve all" applies
 * every confident decision (web fact-checked, free-tier AI); the autonomous cron
 * drains the same queues on a schedule so, ideally, nothing ever waits here.
 */
const QUEUES: { kind: QueueKind; title: string; blurb: string; href: string }[] = [
  {
    kind: "campaigns",
    title: "Campaign reviews",
    blurb: "Auto-generated advocacy campaigns awaiting publication. Dedup, drop dead/enacted bills, publish the live ones.",
    href: "/admin/campaigns/pending",
  },
  {
    kind: "intel",
    title: "Intel queue",
    blurb: "Scraped policy news awaiting review for /pulse. Dedup, drop stale/hallucinated items, publish verified news.",
    href: "/admin/intel-queue",
  },
];

export default async function ModerationPage() {
  const ctx = await getAdminContext({ require: "moderate_forum" });
  if (!ctx.ok) redirect("/dashboard");
  const counts = await queueCounts();
  const countOf = (k: QueueKind) => (k === "campaigns" ? counts.campaigns : counts.intel);
  const total = counts.campaigns + counts.intel;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</Link>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Moderation</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Every review queue in one place. <strong className="text-zinc-200">{total}</strong> item{total === 1 ? "" : "s"} pending.
          Hit <span className="text-emerald-400">Auto-resolve all</span> to clear a queue in one click — every item is decided
          automatically (dedup, drop stale/hallucinated, publish the live ones), web fact-checked on the free-tier router.
          Approvals notify users, so they only fire on a confident verdict; anything uncertain is safely rejected. The
          autonomous cleaner also runs on a schedule, so ideally these stay at zero without you lifting a finger.
        </p>
      </header>

      {total === 0 && (
        <div className="mb-6 rounded-lg border border-emerald-800/40 bg-emerald-950/10 p-4 text-sm text-emerald-300">
          ✓ All queues are empty. Nothing needs your attention.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {QUEUES.map((q) => {
          const n = countOf(q.kind);
          return (
            <div key={q.kind} className="flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold text-zinc-100">{q.title}</h2>
                <span className={`text-2xl font-bold ${n ? "text-amber-400" : "text-zinc-600"}`}>{n}</span>
              </div>
              <p className="mt-1 flex-1 text-xs text-zinc-500">{q.blurb}</p>
              <div className="mt-3">
                <ResolveQueue kind={q.kind} />
              </div>
              <Link href={q.href} className="mt-3 text-[11px] text-zinc-500 hover:text-emerald-400">Open full queue →</Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
