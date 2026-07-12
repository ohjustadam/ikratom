import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import {
  listRecentChatMessages,
  listMutedChatUsers,
  listBanReviewQueue,
  listHeldChatMessages,
  releaseHeldMessage,
  dismissHeldMessage,
} from "@/modules/admin/lounge-actions";
import { LoungeModerationPanel } from "./LoungeModerationPanel";

/**
 * /admin/lounge — central moderation surface for the Lounge chat.
 *
 * Top section: ban-review queue (≥72h cumulative mutes). Middle section:
 * currently-muted users with one-click unmute. Bottom: latest 200
 * messages with bulk-delete + per-row mute. Server-side data fetch so
 * the admin always lands on a fresh snapshot.
 */
export const metadata = { title: "Lounge moderation" };

export default async function AdminLoungePage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const [msgs, muted, banReview, held] = await Promise.all([
    listRecentChatMessages({ limit: 200, room: "lounge" }),
    listMutedChatUsers(),
    listBanReviewQueue(),
    listHeldChatMessages(),
  ]);
  const heldRows = "ok" in held ? held.rows : [];

  const messages = "ok" in msgs ? msgs.rows : [];
  const mutedUsers = ("ok" in muted ? muted.rows : []) as {
    id: string;
    full_name: string | null;
    chat_muted_until: string | null;
  }[];
  const banReviewRows = ("ok" in banReview ? banReview.rows : []) as {
    user_id: string;
    full_name: string | null;
    mute_count: number;
    total_capped_hours: number;
    current_mute_until: string | null;
  }[];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Lounge moderation</h1>
        <p className="mt-1 text-sm text-zinc-400">
          {messages.length === 0
            ? "Lounge is empty."
            : `Last ${messages.length} message${messages.length === 1 ? "" : "s"} (most recent first). Select rows for bulk delete, or mute the author from chat.`}
        </p>
      </header>

      {heldRows.length > 0 && (
        <section className="mb-8 rounded-lg border border-amber-800/50 bg-amber-950/20 p-4">
          <h2 className="mb-1 text-lg font-semibold text-amber-300">
            ⚠ Held for review ({heldRows.length})
          </h2>
          <p className="mb-4 text-xs text-zinc-400">
            AI-flagged as possible abuse and withheld from the lounge. Release to post it as the
            author, or dismiss to reject it. Fail-open: only confident abuse verdicts land here.
          </p>
          <ul className="space-y-3">
            {heldRows.map((h) => (
              <li key={h.id} className="rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="font-medium text-zinc-300">@{h.username ?? "unknown"}</span>
                  {h.category && (
                    <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-300">{h.category}</span>
                  )}
                  {h.ai_confidence != null && <span>conf {Math.round(h.ai_confidence * 100)}%</span>}
                  <span>{new Date(h.created_at).toLocaleString()}</span>
                </div>
                <p className="mb-2 whitespace-pre-wrap break-words text-sm text-zinc-100">{h.body}</p>
                {h.reason && <p className="mb-2 text-xs italic text-zinc-500">AI: {h.reason}</p>}
                <div className="flex gap-2">
                  <form action={releaseHeldMessage}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600">
                      Release
                    </button>
                  </form>
                  <form action={dismissHeldMessage}>
                    <input type="hidden" name="id" value={h.id} />
                    <button className="rounded bg-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-100 hover:bg-zinc-600">
                      Dismiss
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <LoungeModerationPanel
        initialMessages={messages}
        initialMuted={mutedUsers}
        initialBanReview={banReviewRows}
      />
    </div>
  );
}
