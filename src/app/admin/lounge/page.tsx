import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import {
  listRecentChatMessages,
  listMutedChatUsers,
  listBanReviewQueue,
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

  const [msgs, muted, banReview] = await Promise.all([
    listRecentChatMessages({ limit: 200, room: "lounge" }),
    listMutedChatUsers(),
    listBanReviewQueue(),
  ]);

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

      <LoungeModerationPanel
        initialMessages={messages}
        initialMuted={mutedUsers}
        initialBanReview={banReviewRows}
      />
    </div>
  );
}
