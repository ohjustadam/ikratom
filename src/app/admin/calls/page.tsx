import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listPendingCalls } from "@/modules/admin/call-moderation-actions";
import { CallModerationClient } from "./CallModerationClient";

export const metadata = { title: "Call intel review" };
export const dynamic = "force-dynamic";

/**
 * /admin/calls — moderation queue for the calls→intel pipeline. The pending→
 * approved transition lives ONLY here (no auto-approval): a call transcript can
 * name + quote an official, so a human signs off before anything is public.
 * Approving publishes the quote-free summary + position to /calls/board; the
 * caller's identity, raw transcript, and verbatim quotes are never published.
 */
export default async function AdminCallsPage() {
  const ctx = await getAdminContext({ require: "moderate_calls" });
  if (!ctx.ok) redirect("/dashboard");
  const pending = await listPendingCalls();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Call intel review</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Advocates who finished a tracked call and opted to share land here.
          Approving publishes the <strong className="text-zinc-200">quote-free</strong> summary +
          stated position to <a href="/calls/board" className="text-emerald-400 hover:underline">/calls/board</a>.
          The caller&apos;s identity, the raw transcript, and any verbatim quotes are kept private and
          are never published. <strong className="text-zinc-200">{pending.length}</strong> awaiting review.
        </p>
      </header>
      <CallModerationClient pending={pending} />
    </div>
  );
}
