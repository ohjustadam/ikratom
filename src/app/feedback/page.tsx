import { redirect } from "next/navigation";
import { listMyFeedback } from "@/modules/feedback/mine";

export const metadata = { title: "Your feedback" };

/**
 * A signed-in member's own feedback reports and the team's replies. The
 * reply notification links here (/feedback#r-<id>). Access is checked here,
 * in the page, not in a layout.
 */
export default async function MyFeedbackPage() {
  const r = await listMyFeedback();
  if ("error" in r && r.error === "signed_out") redirect("/login?redirect=/feedback");
  const rows = "ok" in r ? r.rows : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Your feedback</h1>
        <p className="mt-2 text-sm text-zinc-400">
          What you sent with the Feedback tab, and the team&apos;s replies.
        </p>
      </header>

      {"error" in r && <p className="text-sm text-red-400">Couldn&apos;t load your feedback. Try again in a minute.</p>}

      {"ok" in r && rows.length === 0 && (
        <p className="text-sm text-zinc-500">
          You haven&apos;t sent any feedback yet. Use the Feedback tab on the right edge of any page.
        </p>
      )}

      <ul className="space-y-4">
        {rows.map((row) => (
          <li
            key={row.id}
            id={`r-${row.id}`}
            className="scroll-mt-24 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4"
          >
            <p className="text-[11px] text-zinc-500">
              You wrote · {new Date(row.created_at).toLocaleDateString()}
              {row.status === "resolved" && <span className="ml-2 text-emerald-400">resolved</span>}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-200">{row.message}</p>

            {row.replies.length === 0 ? (
              <p className="mt-3 text-xs text-zinc-500">No reply yet.</p>
            ) : (
              <ol className="mt-3 space-y-3 border-l-2 border-emerald-700/60 pl-3">
                {row.replies.map((rep, i) => (
                  <li key={i}>
                    <p className="text-[11px] font-semibold text-emerald-400">
                      iKratom team · {new Date(rep.created_at).toLocaleDateString()}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-zinc-100">{rep.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
