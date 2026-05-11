import { redirect } from "next/navigation";
import { getAdminContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { UserRolesRow } from "./UserRolesRow";

export const metadata = { title: "Admin · Users" };

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await getAdminContext();
  if (!ctx.ok) redirect("/dashboard");

  const { q } = await searchParams;
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

  const { data: users } = await query;

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

      <form action="/admin/users" className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by email, name, or city…"
          className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
        <button className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:border-emerald-500">
          Search
        </button>
      </form>

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
