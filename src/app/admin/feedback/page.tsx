import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listFeedback } from "@/modules/feedback/actions";
import { FeedbackItem } from "./FeedbackItem";

export const metadata = { title: "Feedback queue · Admin" };
export const dynamic = "force-dynamic";

const TABS = ["open", "resolved", "all"] as const;

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const ctx = await getAdminContext({ require: "moderate_feedback" });
  if (!ctx.ok) redirect("/dashboard");

  const sp = await searchParams;
  const status: "open" | "resolved" | "all" =
    sp.status === "resolved" ? "resolved" : sp.status === "all" ? "all" : "open";

  const r = await listFeedback(status);
  const rows = "ok" in r ? r.rows : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 text-zinc-100">
      <h1 className="text-2xl font-bold">Feedback reports</h1>
      <p className="mt-1 text-sm text-zinc-400">
        User-submitted feedback + bug reports from the floating widget. Reply under any report:
        members read it in their notifications, anonymous senders get it by email from the team.
      </p>

      <div className="mt-4 flex gap-2 text-sm">
        {TABS.map((s) => (
          <a
            key={s}
            href={`/admin/feedback?status=${s}`}
            className={`rounded px-3 py-1 capitalize ${
              status === s ? "bg-emerald-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}
          >
            {s}
          </a>
        ))}
      </div>

      {"error" in r && <p className="mt-4 text-red-400">{r.error}</p>}

      {rows.length === 0 ? (
        <p className="mt-8 text-zinc-500">No {status} feedback.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {rows.map((row) => (
            <FeedbackItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
