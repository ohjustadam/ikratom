import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";

/**
 * "YOUR rep is deciding this bill" — district-level urgency callout.
 *
 * Mission lever (the platform's whole point):
 *   When a bill sits in committee, only the ~10-20 legislators ON
 *   that committee can vote it out. Of those, only constituents of
 *   THOSE legislators have leverage. Lobbyists know this and target
 *   precisely; advocates almost never do.
 *
 * This component cross-references:
 *   bill.current_committee_name  ×  the signed-in user's reps' committee assignments
 *
 * Render outcomes:
 *   1. User signed in + rep IS on the committee
 *      → big emerald callout: "YOUR rep X is one of the votes. Call
 *        them. This is the moment your call matters." + tel: + mailto:
 *   2. User signed in + bill in committee + no rep match
 *      → soft note: "This bill is in [Committee]. Your reps aren't on
 *        it. The chair is [Name] ([Party]–[District])."
 *   3. User not signed in OR bill has no current_committee_name
 *      → renders nothing (silent). The bill page's SignUpNudge covers
 *        the "you should sign in" message.
 *
 * Free-tier rule: uses mailto: + tel: links, no transactional email
 * or paid SMS.
 */
export async function YourRepDecidingThisBill({
  billId,
  billState,
  currentCommitteeName,
}: {
  billId: string;
  billState: string;
  currentCommitteeName: string | null;
}) {
  if (!currentCommitteeName) return null;

  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  // Pull profile for reps lookup
  const { data: profile } = await sb
    .from("profiles")
    .select("state, congressional_district, state_senate_district, state_house_district, city, county")
    .eq("id", user.id)
    .single();
  if (!profile?.state) return null;

  // Only meaningful if the bill is in the user's state (or federal,
  // which we treat as nationwide). For now this feature scopes to
  // same-state bills — federal kratom action mostly happens via DEA/FDA
  // not via congressional committee yet.
  if (billState !== profile.state) return null;

  const reps = await getUserLegislators(sb, profile);
  if (reps.length === 0) return null;

  // Fetch every committee assignment for each of the user's reps.
  const repIds = reps.map((r) => r.id);
  const { data: assignments } = await sb
    .from("legislator_committees")
    .select("legislator_id, committee_name, role, chamber, is_kratom_relevant")
    .in("legislator_id", repIds);

  type RepMatch = {
    rep: typeof reps[number];
    role: string;
    committeeName: string;
    isKratomRelevant: boolean;
  };
  const matches: RepMatch[] = [];
  for (const a of assignments ?? []) {
    if (!committeesMatch(currentCommitteeName, a.committee_name)) continue;
    const rep = reps.find((r) => r.id === a.legislator_id);
    if (!rep) continue;
    matches.push({
      rep,
      role: a.role,
      committeeName: a.committee_name,
      isKratomRelevant: !!a.is_kratom_relevant,
    });
  }
  // Any match flagged kratom-relevant boosts the whole section's
  // urgency framing. is_kratom_relevant is admin-curated: 1,600+ rows
  // marked across Health / Judiciary / Codes / Consumer / Drug Policy
  // committees that historically handle kratom bills.
  const isBattleground = matches.some((m) => m.isKratomRelevant);

  // Chair / leadership lookup for the "no match" fallback so we can
  // tell the user WHO is deciding their bill, not just that they
  // don't have leverage.
  let leadership: Array<{ full_name: string; role: string; party: string | null; district: string | null }> = [];
  if (matches.length === 0) {
    const { data: leaders } = await sb
      .from("legislator_committees")
      .select("legislator_id, role")
      .ilike("committee_name", `%${currentCommitteeName.replace(/[%_]/g, " ").slice(0, 60)}%`)
      .in("role", ["chair", "vice_chair", "ranking_member"])
      .limit(5);
    const leaderIds = (leaders ?? []).map((l) => l.legislator_id);
    if (leaderIds.length > 0) {
      const { data: leaderProfiles } = await sb
        .from("legislators")
        .select("id, full_name, party, district")
        .in("id", leaderIds);
      leadership = (leaders ?? [])
        .map((l) => {
          const lp = leaderProfiles?.find((p) => p.id === l.legislator_id);
          if (!lp) return null;
          return { full_name: lp.full_name, role: l.role, party: lp.party, district: lp.district };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => {
          const rank: Record<string, number> = { chair: 0, vice_chair: 1, ranking_member: 2 };
          return (rank[a.role] ?? 9) - (rank[b.role] ?? 9);
        });
    }
  }

  // Render: matches case (highest urgency)
  if (matches.length > 0) {
    const sectionShell = isBattleground
      ? "mb-6 rounded-lg border-2 border-amber-400 bg-amber-950/20 p-5 shadow-[0_0_32px_-8px_rgba(251,191,36,0.55)]"
      : "mb-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/20 p-5 shadow-[0_0_24px_-8px_rgba(16,185,129,0.5)]";
    const chipShell = isBattleground
      ? "rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950"
      : "rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-950";
    const headingShell = isBattleground
      ? "text-sm font-bold uppercase tracking-wider text-amber-300"
      : "text-sm font-bold uppercase tracking-wider text-emerald-300";
    return (
      <section className={sectionShell}>
        <div className="mb-3 flex items-center gap-2">
          <span className={chipShell}>
            {isBattleground ? "🔥 Battleground" : "⚡ Your call counts"}
          </span>
          <h2 className={headingShell}>
            Your rep is deciding this bill
          </h2>
        </div>
        <p className="text-sm text-zinc-200">
          This bill sits in the <span className="font-semibold">{currentCommitteeName}</span>
          {isBattleground ? (
            <> — historically one of the committees where kratom bills are won or lost.</>
          ) : (
            <>.</>
          )}
          {" "}{matches.length === 1 ? "Your representative is" : `${matches.length} of your representatives are`}{" "}
          on it. Lobbyists are calling them right now. They need to hear from constituents too.
        </p>
        <ul className="mt-3 space-y-3">
          {matches.map(({ rep, role, committeeName }) => {
            const roleLabel = ROLE_LABEL[role] ?? "Member";
            const roleAccent = role === "chair" ? "text-amber-300" : role === "vice_chair" ? "text-sky-300" : "text-zinc-300";
            const tel = rep.phone?.replace(/[^\d+]/g, "");
            const mailtoSubject = encodeURIComponent(`Constituent ask: kratom bill ${billState}`);
            return (
              <li
                key={rep.id}
                className="flex flex-wrap items-baseline justify-between gap-3 rounded-md border border-emerald-700/40 bg-emerald-950/15 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">
                    {rep.full_name}
                    {rep.party && (
                      <span className="ml-1.5 text-[10px] font-mono text-zinc-400">({rep.party})</span>
                    )}
                  </p>
                  <p className={`text-[11px] uppercase tracking-wider ${roleAccent}`}>
                    {roleLabel} · {committeeName}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {rep.role.replace(/_/g, " ")}
                    {rep.district ? ` · District ${rep.district}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {tel && (
                    <a
                      href={`tel:${tel}`}
                      className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-zinc-950 hover:bg-emerald-400"
                      data-event="rep_call_committee"
                    >
                      📞 Call {rep.phone}
                    </a>
                  )}
                  {rep.email && (
                    <a
                      href={`mailto:${rep.email}?subject=${mailtoSubject}`}
                      className="rounded-md border border-emerald-700 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:border-emerald-500"
                      data-event="rep_email_committee"
                    >
                      ✉ Email
                    </a>
                  )}
                  <Link
                    href={`/legislators/${rep.id}`}
                    className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
                  >
                    Profile →
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
          Why this matters: the bill can&apos;t advance without a committee vote. The handful of legislators on this committee are the actual decision-makers — your call to them carries far more weight than a generic email to your at-large reps.
        </p>
      </section>
    );
  }

  // No-match fallback — still useful: tell user WHO is deciding so
  // they know the field even if they can't influence it directly.
  if (leadership.length > 0) {
    const chair = leadership.find((l) => l.role === "chair") ?? leadership[0];
    return (
      <aside className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
        <p className="text-xs text-zinc-400">
          📍 This bill is in the <span className="font-semibold text-zinc-200">{currentCommitteeName}</span>.
          Your reps aren&apos;t on this committee, so direct leverage is limited. The chair is{" "}
          <span className="text-zinc-200">{chair.full_name}</span>
          {chair.party && <span className="ml-1 text-zinc-500">({chair.party})</span>}
          {chair.district && <span className="ml-1 text-zinc-500">· District {chair.district}</span>}
          {". "}
          <Link href={`/legislators/committee?name=${encodeURIComponent(currentCommitteeName)}`} className="text-emerald-400 hover:underline">
            See all committee members →
          </Link>
        </p>
      </aside>
    );
  }

  // We know the committee but have no data on its members. Bare hint.
  return (
    <aside className="mb-6 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 text-[11px] text-zinc-500">
      📍 This bill is in the <span className="text-zinc-200">{currentCommitteeName}</span>.
    </aside>
  );
}

const ROLE_LABEL: Record<string, string> = {
  chair: "Chair",
  vice_chair: "Vice chair",
  ranking_member: "Ranking member",
  member: "Member",
};
