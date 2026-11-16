import "server-only";

import { summarizeContentSignals, type ContentSignals } from "@/lib/abuse-content-signals";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const HIDES_ON_REPORTS = { member_photo: "member_photos", wall_post: "wall_posts", wall_comment: "wall_comments" } as const;
type HidingType = keyof typeof HIDES_ON_REPORTS;

/** The week's content signals. Callers check view_security_signals first. */
export async function loadContentSignals(sinceIso: string): Promise<ContentSignals> {
  const sb = createServiceRoleClient();
  const [blocks, contentReports, forumReports, groups] = await Promise.all([
    sb.from("letter_screen_blocks").select("user_id, category").gte("created_at", sinceIso).limit(2000),
    sb.from("content_reports").select("reporter_id, target_type, target_id, created_at").gte("created_at", sinceIso).limit(2000),
    sb.from("forum_post_reports").select("reporter_id, created_at").gte("created_at", sinceIso).limit(2000),
    sb.from("coalitions").select("name, slug, owner_id, created_at").gte("created_at", sinceIso).limit(500),
  ]);
  const content = contentReports.data ?? [];

  // Reported this week and hidden now. Hiding keeps no timestamp of its own.
  const hiddenCounts = await Promise.all(
    (Object.keys(HIDES_ON_REPORTS) as HidingType[]).map(async (type) => {
      const ids = [...new Set(content.filter((r) => r.target_type === type).map((r) => r.target_id))];
      if (!ids.length) return 0;
      const { count } = await sb.from(HIDES_ON_REPORTS[type]).select("id", { count: "exact", head: true }).in("id", ids).eq("status", "hidden");
      return count ?? 0;
    }),
  );

  const reports = [...content, ...(forumReports.data ?? [])];
  const ids = [...new Set([
    ...(blocks.data ?? []).map((b) => b.user_id),
    ...reports.map((r) => r.reporter_id),
    ...(groups.data ?? []).map((g) => g.owner_id),
  ])];
  const { data: profiles } = ids.length
    ? await sb.from("profiles").select("id, username, created_at").in("id", ids.slice(0, 500))
    : { data: [] };

  return summarizeContentSignals({
    blocks: blocks.data ?? [],
    reports,
    groups: groups.data ?? [],
    profiles: profiles ?? [],
    hidden: hiddenCounts.reduce((a, b) => a + b, 0),
  });
}
