import type { createClient } from "@/lib/supabase/server";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";

/**
 * Per-viewer data for "YOUR rep is deciding this bill", computed on the
 * request-bound path (/api/bills/[id]/your-rep), never inside the cached
 * bill page. Reading cookies in the page made production refuse to render
 * it at all (DYNAMIC_SERVER_USAGE) — every /bills/:id returned 500 from at
 * least 2026-09-26 until 2026-10-05.
 */
type SB = Awaited<ReturnType<typeof createClient>>;

export type YourRepData = {
  matches: Array<{
    rep: Awaited<ReturnType<typeof getUserLegislators>>[number];
    role: string;
    committeeName: string;
    isKratomRelevant: boolean;
  }>;
  isBattleground: boolean;
  leadership: Array<{ full_name: string; role: string; party: string | null; district: string | null }>;
};

export async function loadYourRep(
  sb: SB,
  userId: string,
  billState: string,
  currentCommitteeName: string,
): Promise<YourRepData | null> {
  // Pull profile for reps lookup
  const { data: profile } = await sb
    .from("profiles")
    .select("state, congressional_district, state_senate_district, state_house_district, city, county")
    .eq("id", userId)
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

  return { matches, isBattleground, leadership };
}
