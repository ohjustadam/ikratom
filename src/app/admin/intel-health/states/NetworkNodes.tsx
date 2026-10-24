import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";

/**
 * The "live network node" audit (branch B2, 2026-10-23): is each state set up
 * the way Oklahoma was on 2026-10-21? Four checks, each with its threshold:
 * coverage (>= 2 intel sources scraping cleanly), targeting (>= 95% of state
 * legislators reachable by email), people (>= 3 advocates), and a state_status
 * confirmed in the last 120 days. Data: admin_state_network_nodes() (0280),
 * one aggregated row per state, counts only.
 */
type Node = {
  state: string;
  advocates: number;
  legislators: number;
  legislators_with_email: number;
  intel_sources: number;
  intel_sources_healthy: number;
  live_campaigns: number;
  status_leaf: string | null;
  status_confirmed_at: string | null;
};

const STATUS_MAX_AGE_MS = 120 * 86_400_000;

function checks(n: Node, now: number) {
  const reach = n.legislators > 0 ? n.legislators_with_email / n.legislators : 0;
  return {
    coverage: n.intel_sources_healthy >= 2,
    targeting: reach >= 0.95,
    people: n.advocates >= 3,
    status: !!n.status_confirmed_at && now - Date.parse(n.status_confirmed_at) < STATUS_MAX_AGE_MS,
    reach,
  };
}

const mark = (ok: boolean) => (ok ? "text-emerald-400" : "text-red-400");

export default async function NetworkNodes() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_state_network_nodes");
  if (error) {
    return <p className="mb-6 text-xs text-red-400">Network-node audit unavailable: {error.message}</p>;
  }
  const now = Date.now();
  const rows = ((data ?? []) as Node[]).map((n) => ({ n, c: checks(n, now) }));
  const live = rows.filter(({ c }) => c.coverage && c.targeting && c.people && c.status).length;
  const short = (k: "coverage" | "targeting" | "people" | "status") => rows.filter(({ c }) => !c[k]).length;

  return (
    <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">Live network nodes</h2>
      <p className="mt-1 text-xs text-zinc-400">
        <span className="font-semibold text-emerald-400">{live}</span> of {rows.length} states are live nodes.
        Short on: coverage {short("coverage")} · targeting {short("targeting")} · advocates {short("people")} ·
        verified status {short("status")}. Coverage = intel sources scraping cleanly
        (<Link href="/admin/bop-monitor" className="underline">BoP monitor</Link>); status = confirmed in the last 120 days
        (<Link href="/admin/state-status" className="underline">state status</Link>).
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 pr-2">State</th><th className="pr-2">Intel sources</th><th className="pr-2">Legislators reachable</th>
              <th className="pr-2">Advocates</th><th className="pr-2">Status</th><th className="pr-2">Live campaigns</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ n, c }) => (
              <tr key={n.state} className="border-t border-zinc-900">
                <td className="py-1 pr-2 font-mono">
                  <Link href={`/states/${n.state.toLowerCase()}`} className="hover:text-emerald-400">{n.state}</Link>
                </td>
                <td className={`pr-2 ${mark(c.coverage)}`}>{n.intel_sources_healthy}/{n.intel_sources}</td>
                <td className={`pr-2 ${mark(c.targeting)}`}>{Math.round(c.reach * 100)}% of {n.legislators}</td>
                <td className={`pr-2 ${mark(c.people)}`}>{n.advocates}</td>
                <td className={`pr-2 ${mark(c.status)}`}>
                  {n.status_leaf ?? "?"} · {n.status_confirmed_at ? n.status_confirmed_at.slice(0, 10) : "never"}
                </td>
                <td className="pr-2 text-zinc-300">{n.live_campaigns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
