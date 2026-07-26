/**
 * PERMISSION_CATALOG — single source of truth for every owner-toggleable
 * permission. Keep in sync with the v_admin_perms / v_leader_perms arrays
 * in supabase/migrations/0083_granular_permissions.sql.
 *
 * Pure data; no server logic.
 *
 * ⚠️ NOT YET ENFORCED. has_permission() exists in migration 0083 and this
 * catalog drives the UI matrix on /admin/users/[id]/permissions, but no
 * server action and no RLS policy calls it — grep `has_permission` and the
 * only hits are the migration itself and this comment. Overrides are
 * recorded (and audit-logged) but do not restrict anything at runtime.
 *
 * Today's real boundary is the three role flags: is_owner / is_admin /
 * is_advocate_leader. Granting Admin grants everything an admin can reach.
 *
 * To finish this: have each admin server action call has_permission(uid, key)
 * instead of settling for getAdminContext().ok, then drop the red banner on
 * the permissions page. Until then, keep that banner accurate.
 */

export type PermissionCategory =
  | "moderation"
  | "content"
  | "user_management"
  | "data_sync"
  | "communications"
  | "platform";

export type Permission = {
  key: string;
  label: string;
  description: string;
  category: PermissionCategory;
  defaultFor: ("admin" | "leader")[];
  dangerous?: boolean;
};

export const PERMISSION_CATALOG: Permission[] = [
  // Moderation
  {
    key: "moderate_forum",
    label: "Moderate forum",
    description: "Approve / hide flagged threads + posts. Escalate to admin when needed.",
    category: "moderation",
    defaultFor: ["admin", "leader"],
  },
  {
    key: "moderate_lounge",
    label: "Moderate lounge chat",
    description: "Mute users in the live chat room (1h/24h/forever). Delete messages.",
    category: "moderation",
    defaultFor: ["admin"],
  },
  {
    key: "moderate_stories",
    label: "Moderate stories",
    description: "Approve / reject user-submitted advocacy stories.",
    category: "moderation",
    defaultFor: ["admin", "leader"],
  },
  {
    key: "moderate_intel_queue",
    label: "Triage intel queue",
    description: "Approve / reject advocate-submitted policy tips from /alerts/submit.",
    category: "moderation",
    defaultFor: ["admin"],
  },

  // Content
  {
    key: "author_campaigns",
    label: "Author campaigns",
    description: "Create draft campaigns. Always go to pending_review before going live.",
    category: "content",
    defaultFor: ["admin", "leader"],
  },
  {
    key: "approve_campaigns",
    label: "Approve / publish campaigns",
    description: "Approve pending campaigns to make them live to all users.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_campaigns",
    label: "Edit any campaign",
    description: "Modify body, targets, dates of campaigns authored by others.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_bills",
    label: "Edit bills",
    description: "Manually edit bill status, relevance, active flag. MFA-gated.",
    category: "content",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "edit_communities",
    label: "Edit communities",
    description: "Add/edit/archive forum communities + external community links.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_partners",
    label: "Manage partner shops",
    description: "Add partner shops + print QR counter kits.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "add_local_officials",
    label: "Add local officials",
    description: "Add city/county mayor + council members to the legislators table.",
    category: "content",
    defaultFor: ["admin", "leader"],
  },

  // User management
  {
    key: "view_users_list",
    label: "View /admin/users",
    description: "See the full user roster + role flags.",
    category: "user_management",
    defaultFor: ["admin"],
  },
  {
    key: "view_user_emails",
    label: "View user email addresses",
    description: "See email column in /admin/users. Required for password-reset trigger.",
    category: "user_management",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "send_password_reset",
    label: "Trigger password reset",
    description: "Send a password-reset email to any user from their /admin/users row.",
    category: "user_management",
    defaultFor: ["admin"],
  },
  {
    key: "send_magic_link",
    label: "Send magic sign-in link",
    description: "Send a one-click sign-in link for users who can't remember password.",
    category: "user_management",
    defaultFor: ["admin"],
  },
  {
    key: "field_signup",
    label: "Field signup (booths / events)",
    description: "Use /leader/field-signup to onboard advocates in person.",
    category: "user_management",
    defaultFor: ["leader"],
  },

  // Data sync
  {
    key: "sync_legislators",
    label: "Trigger sync jobs",
    description: "Manually fire OpenStates / Congress / LegiScan sync from the admin panel.",
    category: "data_sync",
    defaultFor: ["admin"],
  },

  // Platform
  {
    key: "view_audit_log",
    label: "View audit log",
    description: "Read /admin/audit — every admin action across the platform.",
    category: "platform",
    defaultFor: ["admin"],
  },
  {
    key: "view_admin_dashboard",
    label: "Access /admin",
    description: "See the admin control room. Required for any admin task.",
    category: "platform",
    defaultFor: ["admin", "leader"],
  },
  {
    key: "admin_emergency_mode",
    label: "Toggle emergency mode banner",
    description: "Show the site-wide red banner for urgent FDA actions / hostile bills.",
    category: "platform",
    defaultFor: ["admin"],
    dangerous: true,
  },
];

export const PERMISSION_BY_KEY: Record<string, Permission> = Object.fromEntries(
  PERMISSION_CATALOG.map((p) => [p.key, p]),
);

export const PERMISSIONS_BY_CATEGORY: Record<PermissionCategory, Permission[]> = {
  moderation: PERMISSION_CATALOG.filter((p) => p.category === "moderation"),
  content: PERMISSION_CATALOG.filter((p) => p.category === "content"),
  user_management: PERMISSION_CATALOG.filter((p) => p.category === "user_management"),
  data_sync: PERMISSION_CATALOG.filter((p) => p.category === "data_sync"),
  communications: PERMISSION_CATALOG.filter((p) => p.category === "communications"),
  platform: PERMISSION_CATALOG.filter((p) => p.category === "platform"),
};

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  moderation: "Moderation",
  content: "Content authoring + editing",
  user_management: "User management + support",
  data_sync: "Data sync + scrapers",
  communications: "Communications",
  platform: "Platform administration",
};
