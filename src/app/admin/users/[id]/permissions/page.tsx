import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { getUserEffectivePermissions } from "@/modules/admin/permissions-actions";
import { PERMISSIONS_BY_CATEGORY, CATEGORY_LABELS, type PermissionCategory } from "@/modules/admin/permissions";
import { PermissionRow } from "./PermissionRow";

export const metadata = { title: "User permissions" };
export const dynamic = "force-dynamic";

/**
 * /admin/users/[id]/permissions — owner-only granular permission
 * matrix for one user.
 *
 * Each permission shows: current effective state (granted/denied),
 * source (role default vs explicit override), 3-way toggle to set
 * grant / deny / clear-override.
 *
 * Admins can VIEW this page but cannot edit (server enforces).
 * Non-admins are redirected.
 */
type Override = {
  permission: string;
  granted: boolean;
  reason: string | null;
  granted_by: string | null;
  created_at: string;
};

export default async function UserPermissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");
  const { id } = await params;

  const r = await getUserEffectivePermissions(id);
  if ("error" in r) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-red-300">{r.error}</p>
      </div>
    );
  }
  const { profile, overrides } = r;
  const overrideByKey = new Map<string, Override>(
    (overrides as Override[]).map((o) => [o.permission, o]),
  );

  const categories: PermissionCategory[] = [
    "platform", "moderation", "content", "user_management", "data_sync", "communications",
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin/users" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Users
      </a>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Permissions matrix
        </p>
        <h1 className="mt-1 text-3xl font-bold">{profile.full_name ?? profile.email ?? "User"}</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Granular overrides on top of role defaults. {ctx.isOwner ? "You can edit." : "View only — owner edits."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {profile.is_owner && (
            <span className="rounded bg-amber-500 px-1.5 py-0.5 font-bold text-zinc-950">OWNER</span>
          )}
          {profile.is_admin && (
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 font-bold text-zinc-950">ADMIN</span>
          )}
          {profile.is_advocate_leader && (
            <span className="rounded bg-sky-500 px-1.5 py-0.5 font-bold text-zinc-950">LEADER</span>
          )}
          {!profile.is_admin && !profile.is_owner && !profile.is_advocate_leader && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">USER</span>
          )}
        </div>
      </header>

      {!ctx.isOwner && (
        <div className="mb-6 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-xs text-amber-300">
          You can view this matrix but only the owner can flip toggles. Ask the owner if you need
          a specific permission granted or revoked.
        </div>
      )}

      <div className="space-y-6">
        {categories.map((cat) => {
          const perms = PERMISSIONS_BY_CATEGORY[cat];
          if (perms.length === 0) return null;
          return (
            <section key={cat} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-300">
                {CATEGORY_LABELS[cat]}
              </h2>
              <ul className="space-y-2">
                {perms.map((p) => {
                  const override = overrideByKey.get(p.key);
                  // Role default
                  const isDefault =
                    (profile.is_admin && p.defaultFor.includes("admin")) ||
                    (profile.is_advocate_leader && p.defaultFor.includes("leader")) ||
                    profile.is_owner;
                  // Effective: explicit override wins
                  const effective =
                    override !== undefined ? override.granted : isDefault;
                  return (
                    <PermissionRow
                      key={p.key}
                      userId={id}
                      permission={p}
                      hasOverride={override !== undefined}
                      overrideGranted={override?.granted ?? null}
                      overrideReason={override?.reason ?? null}
                      roleDefault={isDefault}
                      effective={effective}
                      canEdit={ctx.isOwner}
                    />
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-8 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
        <p className="font-semibold text-zinc-300">How resolution works</p>
        <ol className="mt-2 ml-4 list-decimal space-y-1">
          <li>Explicit grant or deny on this matrix wins (highest priority).</li>
          <li>Owner role grants everything by default.</li>
          <li>Admin role grants its default set (the perms tagged ADMIN-DEFAULT below).</li>
          <li>Leader role grants its smaller default set.</li>
          <li>Otherwise: denied.</li>
        </ol>
      </div>
    </div>
  );
}
