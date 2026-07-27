import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { listFeedback } from "@/modules/feedback/actions";
import { FeedbackActions } from "./FeedbackActions";

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
        User-submitted feedback + bug reports from the floating widget.
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
            <li key={row.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="whitespace-pre-wrap text-sm text-zinc-100">{row.message}</p>
                <FeedbackActions id={row.id} status={row.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
                <span>{new Date(row.created_at).toLocaleString()}</span>
                <span>{row.user_id ? "registered user" : "anonymous"}</span>
                {row.status === "resolved" && <span className="text-emerald-400">resolved</span>}
                {row.page_url && <span className="max-w-full break-all">📄 {row.page_url}</span>}
              </div>
              {row.screenshotUrl && (
                <a
                  href={row.screenshotUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={row.screenshotUrl}
                    alt="feedback screenshot"
                    className="max-h-48 rounded border border-zinc-800"
                  />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
