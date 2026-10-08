import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Bills (admin)" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  introduced: "Introduced",
  committee: "Committee",
  passed_chamber: "Passed chamber",
  enacted: "Enacted",
  dead: "Dead",
};
const RELEVANCE_BADGE: Record<string, string> = {
  pro: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40",
  anti: "bg-red-950/40 text-red-300 border-red-700/40",
  neutral: "bg-zinc-900 text-zinc-400 border-zinc-700",
  unknown: "bg-zinc-900 text-zinc-500 border-zinc-800",
};

/**
 * /admin/bills — searchable, filterable list of every bill in the DB.
 * Click any row to open the edit form. Quick-filter by state, scope,
 * status, active flag.
 *
 * Replaces a missing surface: until now /admin only had "Add a bill
 * (manual)" and bills couldn't be edited from the admin panel at all.
 */
export default async function AdminBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; scope?: string; status?: string; q?: string; inactive?: string }>;
}) {
  const ctx = await getCreatorContext({ require: "edit_bills" });
  if (!ctx.ok) redirect("/dashboard");

  const sp = await searchParams;
  const state = sp.state?.toUpperCase();
  const scope = sp.scope;
  const status = sp.status;
  const q = sp.q;
  const showInactive = sp.inactive === "1";

  const supabase = await createClient();
  let query = supabase
    .from("bills")
    .select("id, state, bill_number, title, status, scope, locality, kratom_relevance, last_action_at, active")
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (!showInactive) query = query.eq("active", true);
  if (state && /^[A-Z]{2,4}$/.test(state)) query = query.eq("state", state);
  if (scope && ["state", "federal", "municipal", "county"].includes(scope)) query = query.eq("scope", scope);
  if (status && ["introduced", "committee", "passed_chamber", "enacted", "dead"].includes(status)) query = query.eq("status", status);
  if (q && q.length >= 2) query = query.or(`title.ilike.%${q}%,bill_number.ilike.%${q}%,locality.ilike.%${q}%`);

  const { data: bills } = await query;
  const list = (bills ?? []) as Array<{
    id: string; state: string; bill_number: string; title: string | null;
    status: string | null; scope: string | null; locality: string | null;
    kratom_relevance: string | null; last_action_at: string | null;
    active: boolean;
  }>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>

      <header className="mt-2 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Bills</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Edit any bill — flip status, relevance, active flag. Uses
            require MFA. {list.length} of up to 200 results shown.
          </p>
        </div>
        <a
          href="/admin/bills/new"
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          + Add manual bill
        </a>
      </header>

      {/* Filter bar */}
      <form className="mb-5 flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Search</span>
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="title, number, locality"
            className="mt-1 w-56 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">State</span>
          <input
            name="state"
            defaultValue={state ?? ""}
            placeholder="OK"
            className="mt-1 w-20 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm uppercase text-zinc-100 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Scope</span>
          <select
            name="scope"
            defaultValue={scope ?? ""}
            className="mt-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="">any</option>
            <option value="state">State</option>
            <option value="federal">Federal</option>
            <option value="municipal">Municipal</option>
            <option value="county">County</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="mt-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="">any</option>
            <option value="introduced">Introduced</option>
            <option value="committee">Committee</option>
            <option value="passed_chamber">Passed chamber</option>
            <option value="enacted">Enacted</option>
            <option value="dead">Dead</option>
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-300">
          <input
            type="checkbox"
            name="inactive"
            value="1"
            defaultChecked={showInactive}
            className="rounded border-zinc-700 bg-zinc-900"
          />
          show inactive
        </label>
        <button
          type="submit"
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 hover:border-emerald-500"
        >
          Apply
        </button>
        <a
          href="/admin/bills"
          className="text-xs text-zinc-500 hover:text-emerald-400"
        >
          reset
        </a>
      </form>

      {/* List */}
      {list.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          No bills match those filters.
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map((b) => {
            const relevance = RELEVANCE_BADGE[b.kratom_relevance ?? "unknown"] ?? RELEVANCE_BADGE.unknown;
            const statusLabel = b.status ? (STATUS_LABEL[b.status] ?? b.status) : "—";
            return (
              <li key={b.id}>
                <a
                  href={`/admin/bills/${b.id}/edit`}
                  className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 hover:border-emerald-500 ${
                    b.active ? "border-zinc-800 bg-zinc-950/40" : "border-zinc-900 bg-zinc-950/20 opacity-60"
                  }`}
                >
                  <span className="font-mono text-xs text-zinc-500">{b.state}</span>
                  <span className="font-mono text-xs text-zinc-300">{b.bill_number}</span>
                  {b.scope && b.scope !== "state" && (
                    <span className="rounded bg-purple-950/40 px-1.5 py-0.5 text-[10px] capitalize text-purple-300">
                      {b.scope}
                    </span>
                  )}
                  {b.locality && (
                    <span className="text-[10px] text-zinc-500">📍 {b.locality}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                    {b.title ?? "(no title)"}
                  </span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${relevance}`}>
                    {b.kratom_relevance ?? "?"}
                  </span>
                  <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {statusLabel}
                  </span>
                  {!b.active && (
                    <span className="shrink-0 rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">
                      inactive
                    </span>
                  )}
                  {b.last_action_at && (
                    <span className="shrink-0 text-[10px] text-zinc-600">
                      {new Date(b.last_action_at).toLocaleDateString()}
                    </span>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
