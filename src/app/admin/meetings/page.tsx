import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listMeetingsForReview, getMeetingAutoApprovePolicy } from "@/modules/admin/meetings-actions";
import { MeetingRow } from "./MeetingRow";
import { AutoApprovePolicyPanel } from "./AutoApprovePolicyPanel";

export const metadata = { title: "Municipal meeting moderation" };
export const dynamic = "force-dynamic";

export default async function AdminMeetingsPage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");
  const [meetings, autoApprovePolicy] = await Promise.all([
    listMeetingsForReview(),
    getMeetingAutoApprovePolicy(),
  ]);

  const pending = meetings.filter((m) => m.moderation_status === "pending_review");
  const approved = meetings.filter((m) => m.moderation_status === "approved");

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/intel-health" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Intel Health
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Municipal meetings · moderation</h1>
        <p className="mt-2 text-sm text-zinc-400">
          AI-discovered city/county council + board meetings with kratom on the
          agenda. Approve to push to /calls in the relevant state. Discovered via
          Gemini grounded search; admin verifies before users see them.
        </p>
      </header>

      <AutoApprovePolicyPanel initial={autoApprovePolicy} />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-amber-400">
          🟡 Pending review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
            No meetings awaiting review.
          </p>
        ) : (
          <ul className="space-y-2">
            {pending.map((m) => <MeetingRow key={m.id} m={m} />)}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-emerald-400">
          ✅ Live in production ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-500">
            No approved upcoming meetings.
          </p>
        ) : (
          <ul className="space-y-2">
            {approved.map((m) => <MeetingRow key={m.id} m={m} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
