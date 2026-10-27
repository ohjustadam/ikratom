import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";

/** What's moving in the group's state: active operations and recent alerts. Defensive: any error renders nothing. */
export async function StateIntel({ state }: { state: string }) {
  let ops = 0;
  let alerts = 0;
  try {
    const sb = await createClient();
    const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const cutoff7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [opsRes, alertsRes] = await Promise.all([
      sb.from("bill_cluster_members")
        .select("bill_clusters!inner(slug), bills!inner(state, last_action_at, active)")
        .eq("bills.state", state).eq("bills.active", true).gte("bills.last_action_at", cutoff30),
      sb.from("policy_alerts").select("id", { count: "exact", head: true })
        .eq("locality", state).in("severity", ["critical", "alert"]).gte("created_at", cutoff7),
    ]);
    type Row = { bill_clusters: { slug: string } | Array<{ slug: string }> | null };
    const slugs = new Set<string>();
    for (const r of (opsRes.data ?? []) as Row[]) {
      const cl = Array.isArray(r.bill_clusters) ? r.bill_clusters[0] : r.bill_clusters;
      if (cl) slugs.add(cl.slug);
    }
    ops = slugs.size;
    alerts = alertsRes.count ?? 0;
  } catch { /* defensive */ }

  const chip = "flex min-h-10 items-center rounded-md border border-zinc-800 bg-zinc-950/40 px-3 hover:border-emerald-500";
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">What&apos;s moving in {state}</h2>
      <ul className="flex flex-wrap gap-2 text-sm">
        <li><Link href={`/states/${state}`} className={chip}>🕸 {ops > 0 ? <><strong className="mx-1">{ops}</strong> active operation{ops === 1 ? "" : "s"}</> : `${state} hub`}</Link></li>
        {alerts > 0 && <li><Link href={`/pulse?state=${state}`} className={chip}>🚨 <strong className="mx-1">{alerts}</strong> alert{alerts === 1 ? "" : "s"} · 7 days</Link></li>}
        <li><Link href="/brief" className={chip}>☕ Your daily brief</Link></li>
      </ul>
    </section>
  );
}
