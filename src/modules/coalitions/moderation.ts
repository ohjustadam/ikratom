import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Group content and site moderation. Group boards and events are
 * members-only, but RLS already lets site admins read them (is_admin), so a
 * report in /admin/moderation/reports can open the item in context. This is
 * the one check the group pages use for that read-only moderator view.
 */
export async function isSiteModerator(sb: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await sb.from("profiles").select("is_admin, is_owner").eq("id", userId).maybeSingle();
  return !!(data?.is_admin || data?.is_owner);
}

/**
 * The group and the viewer's standing in it, for a thread or event page.
 * A member gets their role. A site moderator who isn't a member gets a
 * read-only view: the coalitions row of a private group isn't visible to
 * them through RLS, so it is read with the service role only after the
 * moderator check. Anyone else gets null (the page 404s).
 */
export async function groupForViewer(sb: SupabaseClient, slug: string, userId: string) {
  type Group = { id: string; slug: string; name: string };
  const { data: visible } = await sb.from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle();
  if (visible) {
    const { data: m } = await sb.from("coalition_members").select("role")
      .eq("coalition_id", visible.id).eq("user_id", userId).maybeSingle();
    if (m) return { group: visible as Group, role: m.role as "owner" | "admin" | "member", moderator: false };
  }
  if (!(await isSiteModerator(sb, userId))) return null;
  const group = visible ?? (await createServiceRoleClient().from("coalitions").select("id, slug, name").eq("slug", slug).maybeSingle()).data;
  return group ? { group: group as Group, role: null, moderator: true } : null;
}

export const GROUP_REPORT_KINDS = { group_thread: "thread", group_post: "post", group_event: "event", group_chat_message: "chat", group_resource: "resource" } as const;

/** Where a reported group item opens: a redirect that resolves the group's slug server-side. */
export function groupReportHref(type: keyof typeof GROUP_REPORT_KINDS, id: string): string {
  return `/coalitions/go/${GROUP_REPORT_KINDS[type]}/${id}`;
}
