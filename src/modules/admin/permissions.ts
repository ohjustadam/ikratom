/**
 * PERMISSION_CATALOG — single source of truth for every permission on the
 * platform. This file is PURE DATA (no server logic, no imports) so it can be
 * used from server actions, pages, client components, and tests alike.
 *
 * Resolution lives in `resolvePermissions()` at the bottom — also pure, also
 * testable. `getAdminContext()` in ./actions.ts is what calls it with real
 * profile flags + DB overrides.
 *
 * ── The model ──────────────────────────────────────────────────────────────
 * Three role flags (is_owner / is_admin / is_advocate_leader) supply DEFAULTS.
 * The owner can then grant or revoke any individual permission per user via
 * /admin/users/[id]/permissions, WITHOUT changing their role — which is the
 * point: a trusted Advocate Leader can be handed exactly one extra capability
 * (say, lounge moderation) and nothing else.
 *
 * Precedence, highest first:
 *   1. Owner → everything. Explicit denies are IGNORED for the owner, so a
 *      stray revoke can never lock the owner out of their own platform.
 *   2. `ownerOnly` permission → owner and no one else, ever. Not delegable;
 *      the matrix renders these locked and the write action refuses them.
 *   3. Explicit override row (granted=true → yes, granted=false → no).
 *   4. Role default via `defaultFor`.
 *   5. Otherwise denied.
 *
 * Keep in sync with `has_permission()` in supabase/migrations/0246. The TS
 * copy is authoritative for app checks (one query, no per-check round trip);
 * the SQL copy exists for RLS policies and is asserted equal by
 * tests/permission-catalog-sync.test.ts.
 *
 * ── Adding a permission ────────────────────────────────────────────────────
 * 1. Add the entry here.
 * 2. Add the key to the matching array in the newest has_permission migration.
 * 3. Gate the surface: `getAdminContext({ require: "your_key" })`.
 */

export type PermissionCategory =
  | "moderation"
  | "content"
  | "user_management"
  | "data_sync"
  | "communications"
  | "platform";

export type PermissionRole = "admin" | "leader";

export type Permission = {
  key: string;
  label: string;
  description: string;
  category: PermissionCategory;
  /** Roles that get this permission automatically, absent an override. */
  defaultFor: PermissionRole[];
  /** Sharp edge — flagged red in the matrix. Still delegable. */
  dangerous?: boolean;
  /**
   * Owner-reserved. NEVER delegable to anyone, by role default or override.
   * These are the capabilities where "admin" and "owner" must not be the same
   * thing: they can seize accounts, exfiltrate the membership, execute code on
   * a runner holding the service-role key, or bypass RLS outright.
   */
  ownerOnly?: boolean;
};

export const PERMISSION_CATALOG = [
  // ── Moderation ───────────────────────────────────────────────────────────
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
    description: "Approve / reject advocate-submitted policy tips, intel health, sync discrepancies.",
    category: "moderation",
    defaultFor: ["admin"],
  },
  {
    key: "moderate_calls",
    label: "Moderate call reports",
    description: "Review and hide advocate call summaries logged against legislators.",
    category: "moderation",
    defaultFor: ["admin"],
  },
  {
    key: "moderate_feedback",
    label: "Triage feedback",
    description: "Read and resolve in-app feedback submissions.",
    category: "moderation",
    defaultFor: ["admin"],
  },
  {
    key: "review_vendor_applications",
    label: "Review vendor applications",
    description: "Approve / reject shop-owner and vendor verification requests.",
    category: "moderation",
    defaultFor: ["admin"],
  },
  {
    key: "review_local_rep_requests",
    label: "Review local-rep requests",
    description: "Handle advocate requests to add a missing city/county official.",
    category: "moderation",
    defaultFor: ["admin"],
  },

  // ── Content ──────────────────────────────────────────────────────────────
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
    description: "Modify body, targets, dates, and email waves of campaigns authored by others.",
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
  {
    key: "edit_legislators",
    label: "Edit legislators",
    description: "Correct state/federal legislator records and contact details.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_site_content",
    label: "Edit site copy",
    description: "Change public page copy via the mini-CMS (/admin/content). Live sitewide in ~60s.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_library",
    label: "Edit research library",
    description: "Add / edit / remove research library entries.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_academy",
    label: "Edit academy",
    description: "Write advocate-academy lessons, exams, and certification content.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_meetings",
    label: "Edit meetings + events",
    description: "Create and edit public meetings, hearings, and community events.",
    category: "content",
    defaultFor: ["admin"],
  },
  {
    key: "edit_stance",
    label: "Edit legislator stance",
    description: "Publish or correct two-axis stance records. These are FACTS about named people — evidence required.",
    category: "content",
    defaultFor: ["admin"],
    dangerous: true,
  },

  // ── User management ──────────────────────────────────────────────────────
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
    key: "issue_temp_password",
    label: "Issue temporary password",
    description:
      "Generate a temp password and read it to a locked-out user. Returns the plaintext to YOU, so it is a takeover path — never usable against an admin or the owner.",
    category: "user_management",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "field_signup",
    label: "Field signup (booths / events)",
    description: "Use /leader/field-signup to onboard advocates in person.",
    category: "user_management",
    defaultFor: ["leader"],
  },
  {
    key: "manage_roles",
    label: "Grant / revoke roles",
    description:
      "Change is_admin / is_advocate_leader / ownership. Owner-reserved: an admin who can mint admins is an owner in all but name.",
    category: "user_management",
    defaultFor: [],
    ownerOnly: true,
  },
  {
    key: "manage_permissions",
    label: "Edit this permissions matrix",
    description: "Grant or revoke individual permissions for any user. Owner-reserved — it is the key to every other key.",
    category: "user_management",
    defaultFor: [],
    ownerOnly: true,
  },
  {
    key: "lock_accounts",
    label: "Lock / unlock accounts",
    description: "Freeze a user out of the platform entirely. Owner-reserved.",
    category: "user_management",
    defaultFor: [],
    ownerOnly: true,
  },
  {
    key: "export_advocate_pii",
    label: "Export the advocate roster (PII)",
    description:
      "Download every user's real name paired with their resolved districts. Owner-reserved — enough to locate a named advocate, and kratom advocacy carries real-world risk.",
    category: "user_management",
    defaultFor: [],
    ownerOnly: true,
  },

  // ── Data sync ────────────────────────────────────────────────────────────
  {
    key: "sync_legislators",
    label: "Trigger sync jobs",
    description: "Manually fire OpenStates / Congress / LegiScan sync + the lightweight cron endpoints.",
    category: "data_sync",
    defaultFor: ["admin"],
  },
  {
    key: "run_data_diagnostics",
    label: "View diagnostics + data quality",
    description: "Read-only health dashboards: diagnostics, data quality, state status, BOP monitor, notification health.",
    category: "data_sync",
    defaultFor: ["admin"],
  },
  {
    key: "dispatch_workflows",
    label: "Run GitHub Actions pipelines",
    description:
      "Dispatch a full cron pipeline. Owner-reserved: a run executes repo code on a cloud runner holding SUPABASE_SERVICE_ROLE_KEY.",
    category: "data_sync",
    defaultFor: [],
    ownerOnly: true,
  },

  // ── Communications ───────────────────────────────────────────────────────
  {
    key: "admin_emergency_mode",
    label: "Toggle emergency mode banner",
    description: "Show the site-wide red banner for urgent FDA actions / hostile bills.",
    category: "communications",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "send_announcements",
    label: "Post announcements",
    description: "Publish dashboard announcements every user sees until dismissed.",
    category: "communications",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "manage_discord",
    label: "Manage Discord integrations",
    description: "Add / edit outbound Discord webhooks that post platform activity to servers.",
    category: "communications",
    defaultFor: ["admin"],
  },

  // ── Platform ─────────────────────────────────────────────────────────────
  {
    key: "view_admin_dashboard",
    label: "Access /admin",
    description: "See the admin control room. Required for any admin task.",
    category: "platform",
    defaultFor: ["admin", "leader"],
  },
  {
    key: "view_audit_log",
    label: "View audit log",
    description: "Read /admin/audit — every admin action across the platform.",
    category: "platform",
    defaultFor: ["admin"],
  },
  {
    key: "view_ops_console",
    label: "Ops console + checklist",
    description: "Cron health, the daily checklist, automation status, OAuth config. Read-mostly operations surfaces.",
    category: "platform",
    defaultFor: ["admin"],
  },
  {
    key: "view_security_signals",
    label: "View security signals",
    description: "Abuse signals, auth events, and user error reports.",
    category: "platform",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "use_ai_editor",
    label: "Use the AI Editor",
    description:
      "Drive the AI Editor-in-Chief. Its write tools still re-check the permission for each underlying action, so it can never exceed what the operator already holds.",
    category: "platform",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "use_master_edit",
    label: "Use master-edit",
    description: "Bulk entity editing across the whitelisted tables.",
    category: "platform",
    defaultFor: ["admin"],
    dangerous: true,
  },
  {
    key: "run_sql",
    label: "Run raw SQL",
    description:
      "The break-glass console. Owner-reserved: admin_exec_sql is SECURITY DEFINER and bypasses RLS entirely, so it can read auth.users and every private column.",
    category: "platform",
    defaultFor: [],
    ownerOnly: true,
  },
] as const satisfies readonly Permission[];

/** Literal union of every valid permission key — use this, not `string`. */
export type PermissionKey = (typeof PERMISSION_CATALOG)[number]["key"];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSION_CATALOG.map((p) => p.key);

export const PERMISSION_BY_KEY: Record<string, Permission> = Object.fromEntries(
  PERMISSION_CATALOG.map((p) => [p.key, p as Permission]),
);

const CATEGORIES: PermissionCategory[] = [
  "moderation",
  "content",
  "user_management",
  "data_sync",
  "communications",
  "platform",
];

export const PERMISSIONS_BY_CATEGORY: Record<PermissionCategory, Permission[]> =
  Object.fromEntries(
    CATEGORIES.map((c) => [c, PERMISSION_CATALOG.filter((p) => p.category === c) as unknown as Permission[]]),
  ) as Record<PermissionCategory, Permission[]>;

export const CATEGORY_LABELS: Record<PermissionCategory, string> = {
  moderation: "Moderation",
  content: "Content authoring + editing",
  user_management: "User management + support",
  data_sync: "Data sync + scrapers",
  communications: "Communications",
  platform: "Platform administration",
};

/** Owner-reserved keys — convenience for UI and for the write-path guard. */
export const OWNER_ONLY_KEYS: readonly string[] = PERMISSION_CATALOG.filter(
  (p) => "ownerOnly" in p && p.ownerOnly,
).map((p) => p.key);

export function isOwnerOnly(key: string): boolean {
  return OWNER_ONLY_KEYS.includes(key);
}

export type RoleFlags = {
  isOwner: boolean;
  isAdmin: boolean;
  isLeader: boolean;
};

export type PermissionOverride = { permission: string; granted: boolean };

/**
 * Resolve a user's effective permission set. Pure — no IO, no imports. The
 * single place precedence is decided, so the server, the matrix UI, and the
 * tests can never disagree about what someone can do.
 *
 * See the precedence list at the top of this file.
 */
export function resolvePermissions(
  roles: RoleFlags,
  overrides: readonly PermissionOverride[] = [],
): Set<PermissionKey> {
  // 1. Owner holds everything, and explicit denies do not apply to them.
  //    Without this, one bad revoke would lock the owner out permanently
  //    with no in-app way back (the fix would need raw SQL access, which is
  //    itself an owner-only permission — a genuine bricking scenario).
  if (roles.isOwner) return new Set(PERMISSION_KEYS);

  const overrideByKey = new Map(overrides.map((o) => [o.permission, o.granted]));
  const out = new Set<PermissionKey>();

  for (const perm of PERMISSION_CATALOG) {
    // 2. Owner-reserved keys are never delegable — a stale or malicious
    //    override row for one is ignored rather than honored.
    if ("ownerOnly" in perm && perm.ownerOnly) continue;

    // 3. Explicit override beats the role default in both directions.
    const override = overrideByKey.get(perm.key);
    if (override !== undefined) {
      if (override) out.add(perm.key);
      continue;
    }

    // 4. Role default.
    const byRole =
      (roles.isAdmin && (perm.defaultFor as readonly string[]).includes("admin")) ||
      (roles.isLeader && (perm.defaultFor as readonly string[]).includes("leader"));
    if (byRole) out.add(perm.key);
  }

  return out;
}
