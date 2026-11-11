import type { FeedbackRow } from "@/modules/feedback/actions";
import { deliveryLabel } from "@/modules/feedback/reply";
import { FeedbackActions } from "./FeedbackActions";
import { FeedbackReplyForm } from "./FeedbackReplyForm";

/** One report on /admin/feedback: the message, its reply thread, and the reply box. */
export function FeedbackItem({ row }: { row: FeedbackRow }) {
  const reach =
    row.route.channel === "site"
      ? "Signed-in member: your reply shows in their notifications on the site."
      : row.route.channel === "email"
        ? `Anonymous: your reply is emailed to ${row.route.to}${row.contact_email ? "" : " (found in their message)"}.`
        : row.route.why;

  return (
    <li id={`r-${row.id}`} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="whitespace-pre-wrap break-words text-sm text-zinc-100">{row.message}</p>
        <FeedbackActions id={row.id} status={row.status} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        <span>{new Date(row.created_at).toLocaleString()}</span>
        <span>{row.user_id ? "registered user" : "anonymous"}</span>
        {row.status === "resolved" && <span className="text-emerald-400">resolved</span>}
        {row.page_url && <span className="max-w-full break-all">📄 {row.page_url}</span>}
      </div>
      {row.screenshotUrl && (
        <a href={row.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={row.screenshotUrl} alt="feedback screenshot" className="max-h-48 rounded border border-zinc-800" />
        </a>
      )}

      {row.replies.length > 0 && (
        <ol className="mt-4 space-y-2 border-l-2 border-emerald-800/60 pl-3">
          {row.replies.map((r) => (
            <li key={r.id} className="text-sm">
              <p className="whitespace-pre-wrap break-words text-zinc-200">{r.body}</p>
              <p className={`mt-0.5 text-[11px] ${r.status === "failed" ? "text-red-400" : "text-zinc-500"}`}>
                {r.author} · {new Date(r.created_at).toLocaleString()} · {deliveryLabel(r)}
              </p>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-4 text-[11px] text-zinc-500">{reach}</p>
      {row.route.channel !== null && (
        <FeedbackReplyForm id={row.id} resolveByDefault={row.status !== "resolved"} />
      )}
    </li>
  );
}
