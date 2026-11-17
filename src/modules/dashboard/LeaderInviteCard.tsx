import Link from "@/components/Link";
import { applyLeaderInviteIfReady } from "@/modules/admin/leader-invite";

/**
 * Dashboard card for a member the owner invited to lead. Checks the invite on
 * every dashboard visit, so the role turns on the first time they come back
 * verified (the 48-hour wait finishes on its own). Renders nothing for the
 * many members with no invite; that check is one primary-key read.
 */
export async function LeaderInviteCard({ userId, welcome }: { userId: string; welcome: boolean }) {
  const r = await applyLeaderInviteIfReady(userId);

  if (r.state === "applied" || (welcome && r.state === "already")) {
    return (
      <section className="mb-6 rounded-lg border border-emerald-600/60 bg-emerald-950/30 p-4">
        <p className="font-semibold text-emerald-200">🎖 You&apos;re now an Advocate Leader. Welcome.</p>
        <p className="mt-1 text-sm text-zinc-300">
          A short walkthrough is starting. Your tools live on the{" "}
          <Link href="/leader" className="font-semibold text-emerald-400 hover:underline">Leader workshop</Link>.
        </p>
      </section>
    );
  }
  if (r.state !== "waiting") return null;

  const left = r.items.filter((i) => !i.done).length;
  return (
    <section className="mb-6 rounded-lg border border-amber-600/50 bg-amber-950/20 p-4">
      <p className="font-semibold text-amber-200">🎖 You&apos;re invited to be an Advocate Leader</p>
      <p className="mt-1 text-sm text-zinc-300">
        {left === 1 ? "One step left" : `${left} steps left`}. The role turns on by itself once they&apos;re done.
      </p>
      <Link href="/leader/invite" className="mt-2 inline-block text-sm font-semibold text-amber-300 hover:underline">
        See what&apos;s left →
      </Link>
    </section>
  );
}
