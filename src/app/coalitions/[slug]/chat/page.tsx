import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { groupForViewer } from "@/modules/coalitions/moderation";
import type { GroupChatMessage } from "@/modules/coalitions/chat-actions";
import { GroupChat } from "./GroupChat";

/**
 * A group's live chat (migration 0291, B4 e). Members only: RLS returns the
 * lines to members of the group (and site admins), and anyone else gets a
 * 404. A site moderator opening a report (?m=<id>) gets a read-only view of
 * the lines around it.
 */
export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const COLS = "id, coalition_id, user_id, body, created_at";

export default async function GroupChatPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ m?: string }>;
}) {
  const { slug } = await params;
  const { m } = await searchParams;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();
  const viewer = await groupForViewer(sb, slug, user.id);
  if (!viewer) notFound();
  const c = viewer.group;

  let rows: GroupChatMessage[] = [];
  const focus = m && UUID_RE.test(m) ? m : null;
  if (viewer.moderator && focus) {
    // Context around the reported line: 20 before it and 20 after.
    const { data: hit } = await sb.from("coalition_chat_messages").select(COLS).eq("id", focus).eq("coalition_id", c.id).maybeSingle();
    if (hit) {
      const [{ data: before }, { data: after }] = await Promise.all([
        sb.from("coalition_chat_messages").select(COLS).eq("coalition_id", c.id).lt("created_at", hit.created_at).order("created_at", { ascending: false }).limit(20),
        sb.from("coalition_chat_messages").select(COLS).eq("coalition_id", c.id).gt("created_at", hit.created_at).order("created_at", { ascending: true }).limit(20),
      ]);
      rows = [...((before ?? []) as GroupChatMessage[]).reverse(), hit as GroupChatMessage, ...((after ?? []) as GroupChatMessage[])];
    }
  } else {
    const { data } = await sb.from("coalition_chat_messages").select(COLS).eq("coalition_id", c.id)
      .order("created_at", { ascending: false }).limit(60);
    rows = ((data ?? []) as GroupChatMessage[]).reverse();
  }

  const ids = [...new Set([user.id, ...rows.map((r) => r.user_id)])];
  const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: ids });
  const handles: Record<string, string> = {};
  for (const p of (profs ?? []) as { id: string; username: string | null; state: string | null }[]) handles[p.id] = publicHandle(p);

  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-4 sm:px-6 sm:pt-8">
      <Link href={`/coalitions/${c.slug}`} className="text-xs text-zinc-500 hover:text-emerald-400">← {c.name}</Link>
      <h1 className="mb-3 mt-1 text-xl font-bold text-zinc-50">💬 Group chat</h1>
      {viewer.moderator ? (
        <>
          <p className="mb-3 rounded-md border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            Moderator view (read-only). You aren&apos;t a member of this group. The reported message is highlighted.
          </p>
          <ol className="space-y-2 rounded-lg border border-zinc-800 p-3 text-sm">
            {rows.length === 0 && <li className="text-zinc-500">That message has been deleted.</li>}
            {rows.map((r) => (
              <li key={r.id} id={`m-${r.id}`} className={r.id === focus ? "rounded bg-red-950/40 p-1 ring-1 ring-red-500" : ""}>
                <span className="font-semibold text-emerald-300">{handles[r.user_id] ?? "@member"}</span>{" "}
                <span className="whitespace-pre-wrap break-words text-zinc-200">{r.body}</span>{" "}
                <span className="text-[10px] text-zinc-600">{new Date(r.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <GroupChat coalitionId={c.id} initial={rows} handles={handles}
          me={{ id: user.id, handle: handles[user.id] ?? "@you" }}
          canModerate={viewer.role === "owner" || viewer.role === "admin"} />
      )}
      <p className="mt-3 text-[11px] text-zinc-500">
        Everyone here appears by @username only. For anything longer, start a discussion on the{" "}
        <Link href={`/coalitions/${c.slug}#discussion`} className="underline">group board</Link>.
      </p>
    </div>
  );
}
