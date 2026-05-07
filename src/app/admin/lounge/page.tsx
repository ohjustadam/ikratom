import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import {
  listRecentChatMessages,
  listMutedChatUsers,
} from "@/modules/admin/lounge-actions";
import { LoungeModerationPanel } from "./LoungeModerationPanel";

export const metadata = { title: "Lounge moderation" };

export default async function AdminLoungePage() {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const [msgs, muted] = await Promise.all([
    listRecentChatMessages({ limit: 200, room: "lounge" }),
    listMutedChatUsers(),
  ]);

  const messages = "ok" in msgs ? msgs.rows : [];
  const mutedUsers = ("ok" in muted ? muted.rows : []) as {
    id: string;
    full_name: string | null;
    chat_muted_until: string | null;
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

      <LoungeModerationPanel initialMessages={messages} initialMuted={mutedUsers} />
    </div>
  );
}
