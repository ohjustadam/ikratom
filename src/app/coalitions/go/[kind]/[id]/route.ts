/**
 * Open a group thread, reply or event by id alone, the way a report in
 * /admin/moderation/reports refers to it. Resolves the group's slug and
 * redirects, for a member of that group or a site moderator only; everyone
 * else gets a 404, so the route never confirms that a private item exists.
 * ("go" can't collide with a group: slugs are at least 3 characters.)
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isSiteModerator } from "@/modules/coalitions/moderation";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (!["thread", "post", "event"].includes(kind) || !UUID_RE.test(id)) return notFound();
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return notFound();

  const svc = createServiceRoleClient();
  let coalitionId: string | null = null;
  let path = "";
  if (kind === "event") {
    const { data } = await svc.from("coalition_events").select("coalition_id").eq("id", id).maybeSingle();
    coalitionId = data?.coalition_id ?? null;
    path = `events/${id}`;
  } else if (kind === "thread") {
    const { data } = await svc.from("coalition_threads").select("coalition_id").eq("id", id).maybeSingle();
    coalitionId = data?.coalition_id ?? null;
    path = `t/${id}`;
  } else {
    const { data } = await svc.from("coalition_posts").select("coalition_id, thread_id").eq("id", id).maybeSingle();
    coalitionId = data?.coalition_id ?? null;
    path = data ? `t/${data.thread_id}#post-${id}` : "";
  }
  if (!coalitionId) return notFound();

  const { data: member } = await sb.from("coalition_members").select("role")
    .eq("coalition_id", coalitionId).eq("user_id", user.id).maybeSingle();
  if (!member && !(await isSiteModerator(sb, user.id))) return notFound();

  const { data: group } = await svc.from("coalitions").select("slug").eq("id", coalitionId).maybeSingle();
  if (!group) return notFound();
  return NextResponse.redirect(new URL(`/coalitions/${group.slug}/${path}`, req.url), { headers: { "Cache-Control": "private, no-store" } });
}
