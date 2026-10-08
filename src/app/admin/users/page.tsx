import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { UserRolesRow } from "./UserRolesRow";
import { AccountTypesTable } from "./AccountTypesTable";

type SB = Awaited<ReturnType<typeof createClient>>;

/**
 * Mutually-exclusive role tiers (highest wins) so the numbers sum to total —
 * owners are also is_admin, admins are often is_advocate_leader, so raw flag
 * counts would double-count.
 */
async function getUserStats(sb: SB) {
  const head = () => sb.from("profiles").select("id", { count: "exact", head: true });
  const n = async (q: ReturnType<typeof head>) => (await q).count ?? 0;
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const [total, owners, adminsRaw, leadersRaw, newThisWeek, locked] = await Promise.all([
    n(head()),
    n(head().eq("is_owner", true)),
    n(head().eq("is_admin", true).eq("is_owner", false)),
    n(head().eq("is_advocate_leader", true).eq("is_admin", false).eq("is_owner", false)),
    n(head().gte("created_at", weekAgo)),
    n(head().not("account_locked_at", "is", null)),
  ]);
  const members = Math.max(0, total - owners - adminsRaw - leadersRaw);
  return { total, owners, admins: adminsRaw, leaders: leadersRaw, members, newThisWeek, locked };
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-4 py-3">
      <p className={`text-2xl font-bold ${tone ?? "text-zinc-100"}`}>{value.toLocaleString()}</p>
      <p className="mt-0.5 text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
    </div>
  );
}

export const metadata = { title: "Admin · Users" };

type RoleFilter = "all" | "owner" | "admin" | "leader" | "member";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string }>;
}) {
  const ctx = await getAdminContext({ require: "view_users_list" });
  if (!ctx.ok) redirect("/dashboard");

  const { q, role: roleParam } = await searchParams;
  const validRoles: string[] = ["owner", "admin", "leader", "member"];
  const role: RoleFilter = validRoles.includes(roleParam ?? "") ? (roleParam as RoleFilter) : "all";
  const supabase = await createClient();

  let query = supabase
    .from("profiles")
    .select("id, email, full_name, state, city, county, is_admin, is_owner, is_advocate_leader, account_locked_at, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q?.trim()) {
    const term = q.trim();
    query = query.or(`email.ilike.%${term}%,full_name.ilike.%${term}%,city.ilike.%${term}%`);
  }

  // Filter by mutually-exclusive role tier (matches the headcount tiles).
  if (role === "owner") query = query.eq("is_owner", true);
  else if (role === "admin") query = query.eq("is_admin", true).eq("is_owner", false);
  else if (role === "leader") query = query.eq("is_advocate_leader", true).eq("is_admin", false).eq("is_owner", false);
  else if (role === "member") query = query.eq("is_admin", false).eq("is_owner", false).eq("is_advocate_leader", false);

  const [{ data: users }, stats] = await Promise.all([query, getUserStats(supabase)]);
  const roleTabs: { key: RoleFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: stats.total },
    { key: "owner", label: "Owner", count: stats.owners },
    { key: "admin", label: "Admins", count: stats.admins },
    { key: "leader", label: "Leaders", count: stats.leaders },
    { key: "member", label: "Members", count: stats.members },
  ];
  const tabHref = (r: RoleFilter) => {
    const p = new URLSearchParams();
    if (q?.trim()) p.set("q", q.trim());
    if (r !== "all") p.set("role", r);
    const s = p.toString();
    return s ? `/admin/users?${s}` : "/admin/users";
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Users</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage roles. Owners can grant ownership; admins can promote leaders + admins.
        </p>
      </header>

      {/* Headcount — total + mutually-exclusive role tiers (they sum to total) */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Total users" value={stats.total} tone="text-emerald-300" />
        <Stat label="Owner" value={stats.owners} tone="text-amber-300" />
        <Stat label="Admins" value={stats.admins} tone="text-emerald-300" />
        <Stat label="Advocate leaders" value={stats.leaders} tone="text-sky-300" />
        <Stat label="Members" value={stats.members} />
        <Stat label="New this week" value={stats.newThisWeek} tone={stats.newThisWeek > 0 ? "text-emerald-300" : "text-zinc-100"} />
      </div>

      <AccountTypesTable
        counts={{ owners: stats.owners, admins: stats.admins, leaders: stats.leaders, members: stats.members }}
      />

      {/* Role filter tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {roleTabs.map((t) => {
          const active = role === t.key;
          return (
            <a
              key={t.key}
              href={tabHref(t.key)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-emerald-500 bg-emerald-950/30 font-semibold text-emerald-200"
                  : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:border-emerald-600/60"
              }`}
            >
              {t.label} <span className="opacity-70">({t.count})</span>
            </a>
          );
        })}
      </div>

      <form action="/admin/users" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by email, name, or city…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        {/* Preserve the active role filter across a search submit */}
        {role !== "all" && <input type="hidden" name="role" value={role} />}
        <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">
          Search
        </button>
      </form>

      <p className="mb-2 text-xs text-zinc-500">
        {(users ?? []).length} shown{role !== "all" ? ` · ${roleTabs.find((t) => t.key === role)?.label}` : ""}
        {(users ?? []).length === 200 ? " (capped at 200 — narrow with search)" : ""}
      </p>

      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Where</th>
              <th className="p-3 text-center">Roles</th>
              <th className="p-3 text-right">Manage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900 bg-zinc-950/40">
            {(users ?? []).map((u) => (
              <UserRolesRow
                key={u.id}
                user={u}
                callerIsOwner={ctx.isOwner}
                callerUserId={ctx.userId}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
