import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CoalitionAdminPanel } from "./CoalitionAdminPanel";

export const dynamic = "force-dynamic";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data } = await sb
    .from("coalitions")
    .select("name, description, is_public")
    .eq("slug", slug)
    .maybeSingle();
  if (!data) return { title: "Coalition" };
  return {
    title: (data as { name: string }).name,
    description: (data as { description: string | null }).description ?? undefined,
    robots: (data as { is_public: boolean }).is_public ? undefined : { index: false },
  };
}

export default async function CoalitionDetailPage({ params }: { params: Params }) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  const { data: coalitionRow } = await sb
    .from("coalitions")
    .select("id, slug, name, description, state, is_public, owner_id, created_at")
    .eq("slug", slug)
    .maybeSingle();
  if (!coalitionRow) notFound();
  const c = coalitionRow as {
    id: string; slug: string; name: string; description: string | null;
    state: string | null; is_public: boolean; owner_id: string; created_at: string;
  };

  // Is the viewer a member? RLS will filter what they can see in
  // member lists anyway — but we use this to gate the admin panel UX.
  let viewerRole: "owner" | "admin" | "member" | null = null;
  if (user) {
    const { data } = await sb
      .from("coalition_members")
      .select("role")
      .eq("coalition_id", c.id)
      .eq("user_id", user.id)
      .maybeSingle();
    viewerRole = (data as { role: "owner" | "admin" | "member" } | null)?.role ?? null;
  }

  // If the coalition is private and viewer isn't a member, hide it.
  if (!c.is_public && !viewerRole) {
    notFound();
  }

  // Members list — RLS only returns rows if the viewer is a member.
  // We use get_public_profiles RPC to read names without exposing the
  // full profile shape (RLS on profiles is admin-or-self).
  type MemberRow = { user_id: string; role: string; joined_at: string };
  let members: Array<MemberRow & { full_name: string | null }> = [];
  if (viewerRole) {
    const { data: memberRows } = await sb
      .from("coalition_members")
      .select("user_id, role, joined_at")
      .eq("coalition_id", c.id)
      .order("joined_at", { ascending: true });
    const rows = (memberRows ?? []) as MemberRow[];
    const userIds = rows.map((r) => r.user_id);
    let nameByUser = new Map<string, string | null>();
    if (userIds.length > 0) {
      const { data: profs } = await sb
        .rpc("get_public_profiles", { ids: userIds });
      type PProf = { id: string; full_name: string | null };
      for (const p of (profs ?? []) as PProf[]) nameByUser.set(p.id, p.full_name);
    }
    members = rows.map((r) => ({ ...r, full_name: nameByUser.get(r.user_id) ?? null }));
  }

  // For coalitions scoped to a state, pull a tiny slice of state intel
  // so the page is useful at-a-glance — number of recent alerts +
  // active operations. Defensive; pre-cluster-migration deploys skip.
  let stateActiveOps = 0;
  let stateAlerts = 0;
  if (c.state) {
    try {
      const cutoff30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
      const cutoff7 = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      const [opsRes, alertsRes] = await Promise.all([
        sb.from("bill_cluster_members")
          .select("bill_clusters!inner(slug), bills!inner(state, last_action_at, active)")
          .eq("bills.state", c.state)
          .eq("bills.active", true)
          .gte("bills.last_action_at", cutoff30),
        sb.from("policy_alerts")
          .select("id", { count: "exact", head: true })
          .eq("locality", c.state)
          .in("severity", ["critical", "alert"])
          .gte("created_at", cutoff7),
      ]);
      type Row = { bill_clusters: { slug: string } | Array<{ slug: string }> | null };
      const slugs = new Set<string>();
      for (const r of (opsRes.data ?? []) as Row[]) {
        const cl = Array.isArray(r.bill_clusters) ? r.bill_clusters[0] : r.bill_clusters;
        if (cl) slugs.add(cl.slug);
      }
      stateActiveOps = slugs.size;
      stateAlerts = alertsRes.count ?? 0;
    } catch { /* defensive */ }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/coalitions" className="text-zinc-500 hover:text-emerald-400">
          ← Coalitions
        </Link>
      </div>

      <header className="mb-6 mt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Coalition
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="text-3xl font-bold sm:text-4xl">{c.name}</h1>
          {c.state && (
            <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-xs uppercase text-zinc-300">
              {c.state}
            </span>
          )}
          {viewerRole && (
            <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${
              viewerRole === "owner"
                ? "bg-amber-500 text-zinc-950"
                : viewerRole === "admin"
                ? "bg-emerald-700 text-zinc-100"
                : "bg-zinc-800 text-zinc-300"
            }`}>
              You: {viewerRole}
            </span>
          )}
          {!c.is_public && <span className="text-[10px] text-zinc-500">🔒 private</span>}
        </div>
        {c.description && (
          <p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm text-zinc-300">
            {c.description}
          </p>
        )}
      </header>

      {/* State intel widget */}
      {c.state && viewerRole && (stateActiveOps > 0 || stateAlerts > 0) && (
        <section className="mb-6 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            What&apos;s moving in {c.state} right now
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {stateActiveOps > 0 && (
              <li>
                <Link
                  href={`/states/${c.state}`}
                  className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
                >
                  🕸 <strong>{stateActiveOps}</strong> active operation{stateActiveOps === 1 ? "" : "s"}
                </Link>
              </li>
            )}
            {stateAlerts > 0 && (
              <li>
                <Link
                  href={`/pulse?state=${c.state}`}
                  className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
                >
                  🚨 <strong>{stateAlerts}</strong> alert{stateAlerts === 1 ? "" : "s"} · last 7d
                </Link>
              </li>
            )}
            <li>
              <Link
                href="/brief"
                className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1 hover:border-emerald-500"
              >
                ☕ Your daily brief
              </Link>
            </li>
          </ul>
        </section>
      )}

      {/* Members list (gated) */}
      {viewerRole && (
        <section className="mb-6">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-zinc-300">
            Members ({members.length})
          </h2>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.user_id} className="flex flex-wrap items-baseline gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-[11px]">
                <span className="font-semibold text-zinc-100">
                  {m.full_name ?? "(unnamed)"}
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${
                  m.role === "owner"
                    ? "bg-amber-500 text-zinc-950"
                    : m.role === "admin"
                    ? "bg-emerald-700 text-zinc-100"
                    : "bg-zinc-800 text-zinc-300"
                }`}>
                  {m.role}
                </span>
                <span className="ml-auto text-[10px] text-zinc-500">
                  joined {new Date(m.joined_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Admin actions — only owner/admin */}
      {(viewerRole === "owner" || viewerRole === "admin") && (
        <CoalitionAdminPanel coalitionId={c.id} viewerRole={viewerRole} />
      )}

      {!user && c.is_public && (
        <p className="mt-6 rounded-md border border-amber-700/40 bg-amber-950/10 p-3 text-[11px] text-amber-200">
          💡 <Link href="/login" className="font-semibold underline">Sign in</Link> to join this coalition via an invite link from an existing member.
        </p>
      )}
    </div>
  );
}
