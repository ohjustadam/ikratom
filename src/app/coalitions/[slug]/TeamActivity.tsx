import Link from "@/components/Link";
import { createClient } from "@/lib/supabase/server";

/**
 * Which officials the group has been writing to (last 14 days). Aggregate
 * only: send counts per official, never which member sent them. RPCs from
 * migration 0156 guard by membership.
 */
type TopLegRow = {
  legislator_id: string; full_name: string; state: string; role: string; send_count: number; distinct_senders: number;
};

export async function TeamActivity({ coalitionId }: { coalitionId: string }) {
  const sb = await createClient();
  const { data } = await sb.rpc("coalition_top_legislators", { p_coalition_id: coalitionId, p_days: 14, p_limit: 8 });
  const rows = (data as TopLegRow[] | null) ?? [];
  if (rows.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-zinc-300">Officials the group wrote to · 14 days</h2>
      <p className="mb-2 text-[11px] text-zinc-500">Counts only. Nobody sees which member sent what.</p>
      <ul className="space-y-1.5 text-sm">
        {rows.map((l) => (
          <li key={l.legislator_id} className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2">
            <Link href={`/legislators/${l.legislator_id}/briefing`} className="font-semibold text-zinc-100 hover:underline">{l.full_name}</Link>
            <span className="text-[11px] text-zinc-500">{l.state} · {l.role.replace(/_/g, " ")}</span>
            <span className="ml-auto text-xs text-zinc-400">
              <strong className="text-emerald-300">{l.send_count}</strong> letter{l.send_count === 1 ? "" : "s"} · {l.distinct_senders} member{l.distinct_senders === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
