import { createClient } from "@/lib/supabase/server";
import { ReportButton } from "@/modules/reports/components/ReportButton";
import { AUDIENCE_ICON, AUDIENCE_LABEL, isAudience } from "@/modules/profile/audience";
import type { WallPost } from "../types";
import { WallAuthor } from "./WallAuthor";
import { WallComposer } from "./WallComposer";
import { WallComments } from "./WallComments";
import { WallDeleteButton } from "./WallDeleteButton";

/**
 * A member's wall, as this viewer may see it. wall_access + get_wall (0292)
 * decide everything in the database: 'none' renders nothing at all, so a
 * hidden wall is indistinguishable from an empty one.
 */
export async function ProfileWall({ ownerId, handle, viewerId }: { ownerId: string; handle: string; viewerId: string | null }) {
  const supabase = await createClient();
  const [{ data: access }, { data }] = await Promise.all([
    supabase.rpc("wall_access", { p_owner: ownerId }),
    supabase.rpc("get_wall", { p_owner: ownerId, p_limit: 20 }),
  ]);
  if (access !== "post" && access !== "view") return null;
  const posts = (data ?? []) as WallPost[];
  const isSelf = viewerId === ownerId;
  if (access === "view" && posts.length === 0) return null;

  return (
    <section aria-labelledby="wall-h" className="space-y-3">
      <h2 id="wall-h" className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Wall</h2>
      {access === "post" && <WallComposer ownerId={ownerId} isSelf={isSelf} handle={handle} />}
      {posts.length === 0 && <p className="text-sm text-zinc-500">Nothing here yet.</p>}
      {posts.map((p) => (
        <article key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <WallAuthor id={p.author_id} username={p.author_username} avatarUrl={p.author_avatar_url} at={p.created_at} />
            {isSelf && isAudience(p.audience) && (
              <span className="shrink-0 text-[11px] text-zinc-500" title="Who can see this post">
                {AUDIENCE_ICON[p.audience]} {AUDIENCE_LABEL[p.audience]}
              </span>
            )}
          </div>
          <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-zinc-200">{p.body}</p>
          {p.photo_url && (
            // eslint-disable-next-line @next/next/no-img-element -- privacy route 302s to a signed URL
            <img src={p.photo_url} alt="" loading="lazy" className="mt-3 max-h-[28rem] w-full rounded-lg bg-zinc-900 object-contain" />
          )}
          <div className="mt-2 flex gap-3">
            {viewerId && p.author_id !== viewerId && <ReportButton targetType="wall_post" targetId={p.id} />}
            {p.can_delete && <WallDeleteButton postId={p.id} ownerId={ownerId} />}
          </div>
          <WallComments postId={p.id} count={p.comment_count} viewerId={viewerId} />
        </article>
      ))}
    </section>
  );
}
