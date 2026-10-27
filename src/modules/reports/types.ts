/**
 * The ONE member report system (migration 0288): vocabulary shared by the
 * ReportButton, the server action and the admin queue. Pure, so client and
 * server can both import it. The database check constraints are the authority;
 * tests/content-reports.test.ts keeps these lists equal to them.
 */

export const REPORT_TARGETS = [
  "member_photo",
  "profile",
  "lounge_message",
  "story",
  "community_video",
  "dm_user",
  "group_post",
  "group_thread",
  "group_event",
  "group_chat_message",
  "group_resource",
  "wall_post",
  "wall_comment",
] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_REASONS = [
  { id: "personal_info", label: "Shares someone's personal info or location" },
  { id: "harassment", label: "Harassment, bullying or hate" },
  { id: "violence", label: "Violence or threats" },
  { id: "nudity", label: "Nudity or sexual content" },
  { id: "spam", label: "Spam, scam or selling" },
  { id: "misinformation", label: "False or misleading information" },
  { id: "other", label: "Something else" },
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export const TARGET_LABEL: Record<ReportTarget, string> = {
  member_photo: "Photo",
  profile: "Profile",
  lounge_message: "Lounge message",
  story: "Story",
  community_video: "Community video",
  dm_user: "Member (from a DM)",
  group_post: "Group reply",
  group_thread: "Group thread",
  group_event: "Group event",
  group_chat_message: "Group chat message",
  group_resource: "Group resource",
  wall_post: "Wall post",
  wall_comment: "Wall comment",
};

export const NOTE_MAX = 1000;

export function isReportTarget(v: unknown): v is ReportTarget {
  return typeof v === "string" && (REPORT_TARGETS as readonly string[]).includes(v);
}
export function isReportReason(v: unknown): v is ReportReason {
  return typeof v === "string" && REPORT_REASONS.some((r) => r.id === v);
}
export function isTargetId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}

/** Where a moderator can see (and act on) the reported thing. */
export function targetHref(type: ReportTarget, id: string): string | null {
  switch (type) {
    case "member_photo": return "/admin/moderation/photos";
    case "profile":
    case "dm_user": return `/profile/${id}`;
    case "lounge_message": return "/admin/lounge";
    case "story": return "/admin/stories";
    case "community_video": return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
    // Opens the item in its group (read-only for a moderator who isn't a member);
    // the route resolves the group's slug: src/app/coalitions/go/[kind]/[id]/route.ts.
    case "group_post": return `/coalitions/go/post/${encodeURIComponent(id)}`;
    case "group_thread": return `/coalitions/go/thread/${encodeURIComponent(id)}`;
    case "group_event": return `/coalitions/go/event/${encodeURIComponent(id)}`;
    case "group_chat_message": return `/coalitions/go/chat/${encodeURIComponent(id)}`;
    case "group_resource": return `/coalitions/go/resource/${encodeURIComponent(id)}`;
    // The reports queue shows the text itself and links the wall.
    case "wall_post":
    case "wall_comment": return null;
  }
}
