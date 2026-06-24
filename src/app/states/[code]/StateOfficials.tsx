import { createClient } from "@/lib/supabase/server";

/**
 * Collapsible officials directory for the state war-room page (owner spec
 * 2026-06-11): one main dropdown holding role-grouped dropdowns; each
 * official is their own dropdown with one-tap "Email now" / "Call now"
 * inside. Pure <details> — zero client JS, works everywhere.
 */
type Official = {
  id: string;
  full_name: string;
  role: string;
  party: string | null;
  district: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
};

const GROUPS: Array<{ label: string; roles: string[] }> = [
  { label: "🏛 State executives", roles: ["governor", "lt_governor", "attorney_general", "secretary_of_state"] },
  { label: "🇺🇸 Federal delegation", roles: ["us_senate", "us_house"] },
  { label: "⚖ State Senate", roles: ["state_senate"] },
  { label: "🏚 State House", roles: ["state_house"] },
  { label: "📍 Local officials", roles: ["mayor", "city_council", "county_executive", "county_commission", "county_commissioner"] },
];

export async function StateOfficials({ state, stateName }: { state: string; stateName: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("legislators")
    .select("id, full_name, role, party, district, email, phone, title")
    .eq("state", state)
    .eq("active", true)
    .order("role")
    .order("full_name")
    .limit(500);
  if (error || !data?.length) return null;
  const officials = data as Official[];

  // Per-official kratom-vote aggregate (post-P1 vote-linkage). One batched query, no N+1.
  const ids = officials.map((o) => o.id);
  const voteAgg = new Map<string, { restrict: number; total: number }>();
  if (ids.length > 0) {
    type AggRow = { legislator_id: string | null; vote_value: number | null; bill_votes: { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null }[] | { bills: { kratom_relevance: string | null }[] | { kratom_relevance: string | null } | null } | null };
    const { data: vm } = await supabase
      .from("bill_vote_members")
      .select("legislator_id, vote_value, bill_votes!inner(bills!inner(kratom_relevance))")
      .in("legislator_id", ids);
    for (const r of ((vm ?? []) as unknown as AggRow[])) {
      if (!r.legislator_id) continue;
      const bv = Array.isArray(r.bill_votes) ? r.bill_votes[0] : r.bill_votes;
      const b = bv ? (Array.isArray(bv.bills) ? bv.bills[0] : bv.bills) : null;
      if (!b) continue;
      const cur = voteAgg.get(r.legislator_id) ?? { restrict: 0, total: 0 };
      cur.total++;
      if ((r.vote_value === 1 && b.kratom_relevance === "anti") || (r.vote_value === 2 && b.kratom_relevance === "pro")) cur.restrict++;
      voteAgg.set(r.legislator_id, cur);
    }
  }

  const grouped = GROUPS
    .map((g) => ({ ...g, members: officials.filter((o) => g.roles.includes(o.role)) }))
    .filter((g) => g.members.length > 0);
  if (grouped.length === 0) return null;

  return (
    <section className="mb-8">
      <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <summary className="cursor-pointer text-sm font-bold uppercase tracking-wider text-zinc-200 hover:text-emerald-300">
          📇 Your officials in {stateName} · {officials.length}
        </summary>
        <p className="mt-2 text-[11px] text-zinc-500">
          Every official we track for {stateName}, grouped by role. Open a group, tap a name,
          and email or call in one click. Full intel briefings at{" "}
          <a href={`/legislators?state=${state}`} className="text-emerald-400 hover:underline">/legislators</a>.
        </p>
        <div className="mt-3 space-y-2">
          {grouped.map((g) => (
            <details key={g.label} className="rounded-md border border-zinc-800/70 bg-zinc-950/30 p-2.5">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-200">
                {g.label} · {g.members.length}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {g.members.map((o) => (
                  <li key={o.id}>
                    <details className="rounded border border-zinc-900 bg-zinc-950/50 px-2.5 py-1.5">
                      <summary className="cursor-pointer text-xs text-zinc-200 hover:text-emerald-300">
                        <span className="font-medium">{o.full_name}</span>
                        {o.title && <span className="ml-1.5 text-zinc-500">{o.title}</span>}
                        {o.party && <span className="ml-1.5 text-[10px] text-zinc-500">{o.party}</span>}
                        {o.district && <span className="ml-1.5 font-mono text-[10px] text-zinc-600">{o.district}</span>}
                      </summary>
                      {(() => {
                        const a = voteAgg.get(o.id);
                        if (!a || a.total === 0) return null;
                        return (
                          <p className="mt-1 text-[10px] text-zinc-500">
                            🗳 {a.total} kratom vote{a.total === 1 ? "" : "s"}
                            {a.restrict > 0 ? <span className="text-red-300"> · voted to restrict {a.restrict}×</span> : null}
                            {" · "}
                            <a href={`/legislators/${o.id}`} className="text-emerald-400 hover:underline">see record</a>
                          </p>
                        );
                      })()}
                      <div className="mt-2 flex flex-wrap gap-2 pb-1">
                        {o.email ? (
                          <a
                            href={`mailto:${o.email}`}
                            className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-300 hover:border-emerald-500"
                          >
                            ✉ Email now
                          </a>
                        ) : (
                          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">no email on file</span>
                        )}
                        {o.phone ? (
                          <a
                            href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}
                            className="rounded-md border border-sky-700/40 bg-sky-950/20 px-3 py-1.5 text-[11px] font-semibold text-sky-300 hover:border-sky-500"
                          >
                            📞 Call now {o.phone}
                          </a>
                        ) : (
                          <span className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] text-zinc-600">no phone on file</span>
                        )}
                        <a
                          href={`/legislators/${o.id}/briefing`}
                          className="rounded-md border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:border-emerald-500"
                        >
                          ◉ Intel briefing
                        </a>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      </details>
    </section>
  );
}
