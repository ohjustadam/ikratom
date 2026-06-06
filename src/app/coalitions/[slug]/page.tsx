import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CoalitionAdminPanel } from "./CoalitionAdminPanel";
import { publicHandle } from "@/lib/public-handle";

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
  // Names render via publicHandle() (hard anonymity rule): @username, NEVER
  // the real full_name, even to fellow coalition members. get_public_profiles
  // is the public-safe SECURITY DEFINER read (profiles RLS is admin-or-self).
  type MemberRow = { user_id: string; role: string; joined_at: string };
  type MemberView = MemberRow & { username: string | null; state: string | null };
  let members: MemberView[] = [];
  if (viewerRole) {
    const { data: memberRows } = await sb
      .from("coalition_members")
      .select("user_id, role, joined_at")
      .eq("coalition_id", c.id)
      .order("joined_at", { ascending: true });
    const rows = (memberRows ?? []) as MemberRow[];
    const userIds = rows.map((r) => r.user_id);
    const profByUser = new Map<string, { username: string | null; state: string | null }>();
    if (userIds.length > 0) {
      // NOTE: the RPC arg is p_ids (was incorrectly passed as `ids`, which
      // silently returned nothing → blank roster).
      const { data: profs } = await sb.rpc("get_public_profiles", { p_ids: userIds });
      type PProf = { id: string; username: string | null; state: string | null };
      for (const p of (profs ?? []) as PProf[]) profByUser.set(p.id, { username: p.username, state: p.state });
    }
    members = rows.map((r) => ({
      ...r,
      username: profByUser.get(r.user_id)?.username ?? null,
      state: profByUser.get(r.user_id)?.state ?? null,
    }));
  }

  // Coalition contact log — aggregate team activity. Privacy: never
  // expose per-user attribution. RPCs guard by membership; aggregates
  // only. Defensive against pre-migration deploys.
  type ActivitySummary = {
    total_sends: number;
    active_members: number;
    legislators_contacted: number;
    campaigns_used: number;
  };
  type TopLegRow = {
    legislator_id: string;
    full_name: string;
    state: string;
    role: string;
    send_count: number;
    distinct_senders: number;
  };
  let activitySummary: ActivitySummary | null = null;
  let topLegislators: TopLegRow[] = [];
  if (viewerRole) {
    try {
      const [sumRes, legsRes] = await Promise.all([
        sb.rpc("coalition_activity_summary", { p_coalition_id: c.id, p_days: 14 }),
        sb.rpc("coalition_top_legislators", { p_coalition_id: c.id, p_days: 14, p_limit: 8 }),
      ]);
      const sumRows = sumRes.data as ActivitySummary[] | null;
      if (sumRows && sumRows.length > 0) activitySummary = sumRows[0];
      topLegislators = (legsRes.data as TopLegRow[] | null) ?? [];
    } catch { /* pre-migration */ }
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

      {/* Team activity — aggregate only, no per-user attribution. */}
      {viewerRole && activitySummary && activitySummary.total_sends > 0 && (
        <section className="mb-6 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
            🤝 Team activity · last 14 days
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            Aggregate stats only — individual sends aren&apos;t attributed to specific members.
            Privacy first.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-center">
              <p className="text-2xl font-bold text-emerald-300">{activitySummary.total_sends}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">total sends</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-center">
              <p className="text-2xl font-bold text-emerald-300">{activitySummary.active_members}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">members active</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-center">
              <p className="text-2xl font-bold text-emerald-300">{activitySummary.legislators_contacted}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">legislators contacted</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-center">
              <p className="text-2xl font-bold text-emerald-300">{activitySummary.campaigns_used}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">campaigns used</p>
            </div>
          </div>

          {topLegislators.length > 0 && (
            <>
              <h3 className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                Most-contacted legislators
              </h3>
              <ul className="mt-2 space-y-1 text-[11px]">
                {topLegislators.map((l) => (
                  <li key={l.legislator_id} className="flex flex-wrap items-baseline gap-x-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                    <Link href={`/legislators/${l.legislator_id}/briefing`} className="font-semibold text-zinc-100 hover:underline">
                      {l.full_name}
                    </Link>
                    <span className="font-mono text-[10px] text-zinc-500">{l.state}</span>
                    <span className="rounded bg-zinc-900/60 px-1 py-0.5 font-mono text-[9px] uppercase text-zinc-400">
                      {l.role.replace(/_/g, " ")}
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">
                      <strong className="text-emerald-300">{l.send_count}</strong> send{l.send_count === 1 ? "" : "s"} · <strong>{l.distinct_senders}</strong> member{l.distinct_senders === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
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
                  {publicHandle({ username: m.username, state: m.state })}
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
