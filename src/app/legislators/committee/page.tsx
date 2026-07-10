import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmailOfficialButton } from "@/modules/compose/EmailOfficialButton";

export const dynamic = "force-dynamic";

type SP = Promise<{ name?: string; state?: string }>;

export async function generateMetadata({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const name = (sp.name ?? "").trim();
  return {
    title: name ? `${name} — members` : "Committee members",
    description: name
      ? `The legislators who sit on the ${name}. These are the actual decision-makers when a bill is in this committee.`
      : "Committee members lookup.",
    robots: { index: false }, // committee names sourced from external data; not a stable URL
  };
}

/**
 * /legislators/committee?name=Senate%20Health%20Committee
 *
 * Backs the "See all committee members →" link in the
 * YourRepDecidingThisBill no-match fallback on /bills/[id].
 *
 * Why a separate page (vs adding a filter to /legislators):
 *   The browsing UI there is wired for "everyone in state X" with
 *   role filters and search. This view answers a different question:
 *   "who decides bills that land in committee Y" — chair-first,
 *   role chips prominent, party visible. Conceptually closer to a
 *   /bills/[id] detail sub-view than a legislator browser.
 *
 * Data: legislator_committees rows joined to legislators, ordered
 * chair → vice_chair → ranking_member → member, then alphabetical.
 *
 * Free-tier rule: each member's mailto: + tel: links exposed so the
 * page is one-click-actionable even before a user signs up.
 */
export default async function CommitteeMembersPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const name = (sp.name ?? "").trim();
  if (!name || name.length < 6 || name.length > 120) notFound();

  const supabase = await createClient();

  // Fuzzy-match: legislator_committees.committee_name varies slightly
  // by source ("Senate Health Committee" vs "Senate Health"). Match
  // by containment in either direction.
  const { data: rows } = await supabase
    .from("legislator_committees")
    .select("legislator_id, committee_name, role, chamber")
    .or(`committee_name.ilike.%${name}%,committee_name.ilike.${name}%`)
    .limit(200);

  if (!rows || rows.length === 0) notFound();

  // Resolve the most-common committee_name variant (in case the query
  // matched multiple slight spellings) for the page header.
  const variantCounts: Record<string, number> = {};
  for (const r of rows) variantCounts[r.committee_name] = (variantCounts[r.committee_name] ?? 0) + 1;
  const canonical = Object.entries(variantCounts).sort((a, b) => b[1] - a[1])[0][0];

  // Pull legislator profiles for everyone matched
  const legIds = Array.from(new Set(rows.map((r) => r.legislator_id)));
  const { data: legs } = await supabase
    .from("legislators")
    .select("id, full_name, party, district, role, state, email, phone, website")
    .in("id", legIds);

  type Member = {
    id: string;
    full_name: string;
    party: string | null;
    district: string | null;
    role: string;          // chair | vice_chair | ranking_member | member
    state: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    leg_role: string;      // us_senate | us_house | state_senate | state_house
  };

  // Dedupe to one row per legislator (some have multiple matched
  // variants); prefer the role with the highest rank (chair > member).
  const ROLE_RANK: Record<string, number> = {
    chair: 0,
    vice_chair: 1,
    ranking_member: 2,
    member: 9,
  };
  const byLeg: Record<string, Member> = {};
  for (const r of rows) {
    const lp = legs?.find((l) => l.id === r.legislator_id);
    if (!lp) continue;
    const existing = byLeg[r.legislator_id];
    if (!existing || (ROLE_RANK[r.role] ?? 99) < (ROLE_RANK[existing.role] ?? 99)) {
      byLeg[r.legislator_id] = {
        id: lp.id,
        full_name: lp.full_name,
        party: lp.party,
        district: lp.district,
        role: r.role,
        state: lp.state,
        email: lp.email,
        phone: lp.phone,
        website: lp.website,
        leg_role: lp.role,
      };
    }
  }
  const members = Object.values(byLeg).sort((a, b) => {
    const ra = ROLE_RANK[a.role] ?? 99;
    const rb = ROLE_RANK[b.role] ?? 99;
    if (ra !== rb) return ra - rb;
    return a.full_name.localeCompare(b.full_name);
  });

  // Group by state since some committees (Joint, multi-state) span more
  const states = Array.from(new Set(members.map((m) => m.state))).sort();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="text-xs">
        <Link href="/legislators" className="text-zinc-500 hover:text-emerald-400">
          ← All legislators
        </Link>
      </div>
      <header className="mt-2 mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Committee membership
        </p>
        <h1 className="mt-2 text-3xl font-bold">{canonical}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {members.length} member{members.length === 1 ? "" : "s"}
          {states.length === 1 ? ` · ${states[0]}` : ` · ${states.length} states`}.
          {" "}When a bill is in this committee, these are the actual decision-makers — lobbyists target them precisely. Constituents of these legislators have the highest leverage.
        </p>
      </header>

      <ul className="space-y-3">
        {members.map((m) => {
          const tel = m.phone?.replace(/[^\d+]/g, "");
          const roleLabel =
            m.role === "chair" ? "Chair" :
            m.role === "vice_chair" ? "Vice chair" :
            m.role === "ranking_member" ? "Ranking member" :
            "Member";
          const roleAccent =
            m.role === "chair" ? "bg-amber-500 text-zinc-950" :
            m.role === "vice_chair" ? "bg-sky-700 text-zinc-100" :
            m.role === "ranking_member" ? "bg-violet-700 text-zinc-100" :
            "bg-zinc-800 text-zinc-300";
          return (
            <li
              key={m.id}
              className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleAccent}`}>
                    {roleLabel}
                  </span>
                  <span className="text-sm font-semibold text-zinc-100">
                    {m.full_name}
                  </span>
                  {m.party && (
                    <span className="text-[11px] font-mono text-zinc-400">({m.party})</span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {m.leg_role.replace(/_/g, " ")} · {m.state}
                  {m.district ? ` · District ${m.district}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {tel && (
                  <a
                    href={`tel:${tel}`}
                    className="rounded-md border border-emerald-700 px-2.5 py-1 text-xs text-emerald-300 hover:border-emerald-500"
                  >
                    📞 {m.phone}
                  </a>
                )}
                <EmailOfficialButton
                  official={{ id: m.id, name: m.full_name, role: m.leg_role, state: m.state, email: m.email, website: m.website }}
                  context={{ kind: "legislator" }}
                  source="committee_page"
                  variant="chip"
                />
                <Link
                  href={`/legislators/${m.id}/briefing`}
                  className="rounded-md border border-emerald-700 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
                  title="Full intel briefing — stance, leverage, action plan"
                >
                  ◉ Brief →
                </Link>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-[11px] text-zinc-600">
        Data source: <code className="font-mono">legislator_committees</code> table, populated nightly via OpenStates committee sync. Committee names may vary slightly between data sources; this view fuzzy-matches.
      </p>
    </div>
  );
}
