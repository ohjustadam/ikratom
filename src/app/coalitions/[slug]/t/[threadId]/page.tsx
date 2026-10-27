import Link from "@/components/Link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicHandle } from "@/lib/public-handle";
import { groupForViewer } from "@/modules/coalitions/moderation";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { PinButton, ReplyForm, RemoveButton } from "./ThreadClient";

/**
 * One discussion in a coalition's private board (migration 0273). RLS returns
 * the thread only to members of that coalition (and site admins), so anyone
 * else gets a 404 rather than a hint that it exists.
 */
export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string; threadId: string }>;

export const metadata = { robots: { index: false } };

export default async function CoalitionThreadPage({ params }: { params: Params }) {
  const { slug, threadId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(threadId)) notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) notFound();

  // Members, plus a read-only view for site moderators opening a report.
  const viewer = await groupForViewer(sb, slug, user.id);
  if (!viewer) notFound();
  const c = viewer.group;

  const [{ data: thread }, { data: postRows }] = await Promise.all([
    sb.from("coalition_threads")
      .select("id, title, body, author_id, created_at, pinned_at")
      .eq("id", threadId).eq("coalition_id", c.id).is("deleted_at", null).maybeSingle(),
    sb.from("coalition_posts")
      .select("id, body, author_id, created_at")
      .eq("thread_id", threadId).is("deleted_at", null)
      .order("created_at", { ascending: true }).limit(500),
  ]);
  if (!thread) notFound();
  const isMember = !viewer.moderator;

  const posts = (postRows ?? []) as { id: string; body: string; author_id: string; created_at: string }[];
  const ids = [...new Set([thread.author_id, ...posts.map((p) => p.author_id)])];
  const handles = new Map<string, string>();
  const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: ids });
  for (const p of (profs ?? []) as { id: string; username: string | null; state: string | null }[]) {
    handles.set(p.id, publicHandle(p));
  }
  const canModerate = viewer.role === "owner" || viewer.role === "admin";
  const who = (id: string) => handles.get(id) ?? "@member";
  const when = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href={`/coalitions/${c.slug}#discussion`} className="text-xs text-zinc-500 hover:text-emerald-400">
        ← {c.name}
      </Link>
      {viewer.moderator && (
        <p className="mt-2 rounded border border-amber-700/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
          Moderator view: you aren&apos;t a member of this group. Read-only; act from the reports queue.
        </p>
      )}

      <article className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">{thread.title}</h1>
        <p className="mt-1 text-[11px] text-zinc-500">{who(thread.author_id)} · {when(thread.created_at)}</p>
        <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-200">{thread.body}</p>
        {(thread.author_id === user.id || canModerate) && (
          <RemoveButton slug={c.slug} kind="thread" id={thread.id} redirectTo={`/coalitions/${c.slug}#discussion`} />
        )}
        {canModerate && <PinButton slug={c.slug} threadId={thread.id} pinned={!!thread.pinned_at} />}
        {isMember && thread.author_id !== user.id && <ReportButton targetType="group_thread" targetId={thread.id} className="ml-3 text-[11px] text-zinc-500 hover:text-amber-300" />}
      </article>

      <ul className="mt-4 space-y-2">
        {posts.map((p) => (
          <li key={p.id} id={`post-${p.id}`} className="scroll-mt-20 rounded-lg border border-zinc-800 bg-zinc-950/30 p-3 target:border-amber-500">
            <p className="text-[11px] text-zinc-500">{who(p.author_id)} · {when(p.created_at)}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-200">{p.body}</p>
            {(p.author_id === user.id || canModerate) && (
              <RemoveButton slug={c.slug} kind="post" id={p.id} />
            )}
            {isMember && p.author_id !== user.id && <ReportButton targetType="group_post" targetId={p.id} className="ml-3 text-[11px] text-zinc-500 hover:text-amber-300" />}
          </li>
        ))}
      </ul>

      {isMember && <div id="reply" className="scroll-mt-20"><ReplyForm slug={c.slug} threadId={thread.id} /></div>}
    </div>
  );
}
