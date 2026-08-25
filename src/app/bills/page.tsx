import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BillsBrowser } from "./BillsBrowser";
import { BopWatchSummary } from "@/modules/bop/BopWatchSummary";
import { getUserLegislators } from "@/lib/legislators";
import { committeesMatch } from "@/lib/bill-committee";

export const metadata = { title: "Bill tracker" };
// Force fresh — bills sync hourly via the cron + we don't want stale renders
export const dynamic = "force-dynamic";

// Shape returned by the page query. Supabase generated types lag the
// migration that added summary_ai/advocacy_callout/relevance_confidence,
// so we declare the row shape here and cast at the boundary.
type BillRow = {
  id: string;
  state: string;
  bill_number: string;
  title: string | null;
  summary: string | null;
  summary_ai: string | null;
  advocacy_callout: string | null;
  status: string | null;
  kratom_relevance: string | null;
  relevance_confidence: number | null;
  last_action: string | null;
  last_action_at: string | null;
  source_url: string | null;
  official_url: string | null;
  session_id: string | null;
  scope: string | null;
  locality: string | null;
  active: boolean | null;
};

type SP = Promise<{ filter?: string; state?: string }>;

// Public bill list snapshot, cached across requests (15-min revalidate)
// instead of a 1500-row table scan on every /bills view. Service-role client
// because the data is public and unstable_cache can't use the cookie-bound
// request client; explicit public-safe columns only — never select("*") here.
//
// Both current AND past-session bills: the browser sections them by the
// truthful `active` flag (current session / enacted vs concluded attempts).
// Filtering active-only here made the "Past sessions" view impossible and
// recency windows rendered states like OK as "0 bills" while holding 8.
const getBillsSnapshot = unstable_cache(
  async (): Promise<BillRow[]> => {
    const supabase = createServiceRoleClient();
    const { data: billsRaw } = await supabase
      .from("bills")
      .select(
        "id, state, bill_number, title, summary, summary_ai, advocacy_callout, " +
        "status, kratom_relevance, relevance_confidence, last_action, last_action_at, " +
        "source_url, official_url, session_id, scope, locality, active"
      )
      .order("active", { ascending: false })
      .order("last_action_at", { ascending: false, nullsFirst: false })
      .limit(1500);
    return (billsRaw ?? []) as unknown as BillRow[];
  },
  ["bills-index-snapshot"],
  { revalidate: 900, tags: ["bills-index-snapshot"] },
);

export default async function BillsPage({ searchParams }: { searchParams?: SP }) {
  const sp = searchParams ? await searchParams : {};
  const filter = sp.filter ?? null;
  const wantsCommitteeFilter = filter === "in-my-committees";
  // Honor ?state=XX (e.g. the "← All {state} bills" link from a bill page).
  const stateParam = (sp.state ?? "").toUpperCase();
  const initialState = /^[A-Z]{2}$/.test(stateParam) ? stateParam : null;

  const supabase = await createClient();
  const allBills = await getBillsSnapshot();

  const { data: { user } } = await supabase.auth.getUser();
  let userState: string | null = null;
  let userId: string | null = null;
  type ProfileShape = {
    state: string | null;
    congressional_district: string | null;
    state_senate_district: string | null;
    state_house_district: string | null;
    city: string | null;
    county: string | null;
  };
  let profile: ProfileShape | null = null;
  if (user) {
    userId = user.id;
    const { data: prof } = await supabase
      .from("profiles")
      .select("state, congressional_district, state_senate_district, state_house_district, city, county")
      .eq("id", user.id)
      .single();
    profile = (prof as unknown) as ProfileShape | null;
    userState = profile?.state ?? null;
  }

  // Pre-filter to "bills your reps are deciding" when requested.
  // Server-side narrow: pull current_committee_name per bill, get user's
  // reps' committee assignments, intersect. Falls back gracefully when
  // the user isn't signed in, has no state, or no reps have committee
  // assignments — banner stays but the filtered list will simply be empty.
  let filteredBills = allBills;
  let committeeFilterCount: number | null = null;
  let committeeFilterErrorReason: string | null = null;
  if (wantsCommitteeFilter) {
    if (!userId) {
      committeeFilterErrorReason = "sign-in required";
    } else if (!userState) {
      committeeFilterErrorReason = "your profile needs a state";
    } else {
      // Pull current_committee_name for the bills we have on hand.
      // Wrapped in try/catch in case the column doesn't exist (pre-
      // migration deploy of /bills page on a pre-0123 DB).
      const billIdSet = new Set(allBills.map((b) => b.id));
      const committeeByBill: Record<string, string | null> = {};
      try {
        const { data: ccRows } = await supabase
          .from("bills")
          .select("id, current_committee_name")
          .in("id", Array.from(billIdSet));
        for (const r of ccRows ?? []) {
          committeeByBill[(r as { id: string }).id] =
            (r as { current_committee_name?: string | null }).current_committee_name ?? null;
        }
      } catch {
        // Column missing — no committee filter possible.
      }

      // Resolve user's reps + their committee assignments.
      const reps = profile
        ? await getUserLegislators(supabase, profile as Parameters<typeof getUserLegislators>[1])
        : [];
      if (reps.length === 0) {
        committeeFilterErrorReason = "no representatives matched your address";
      } else {
        const { data: assignments } = await supabase
          .from("legislator_committees")
          .select("committee_name")
          .in("legislator_id", reps.map((r) => r.id));
        const myCommitteeNames = (assignments ?? []).map(
          (a) => (a as { committee_name: string }).committee_name,
        );

        // Narrow: bill is in user's state AND has a committee that matches
        // any of the user's reps' committee assignments.
        filteredBills = allBills.filter((b) => {
          if (b.state !== userState) return false;
          const cc = committeeByBill[b.id];
          if (!cc) return false;
          return myCommitteeNames.some((mc) => committeesMatch(cc, mc));
        });
        committeeFilterCount = filteredBills.length;
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Bill tracker</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every kratom + 7-OH bill across all 50 states — full timelines synced from LegiScan
          {" "}+ OpenStates. Current bills on top; past sessions &amp; closed attempts in their own
          section below. Pro/anti relevance auto-classified, human review recommended.
        </p>
      </header>

      {/* Committee-filter banner — renders only when ?filter=in-my-committees
          is active. Communicates the narrow + offers a one-click escape. */}
      {wantsCommitteeFilter && (
        <div className="mb-6 rounded-lg border-2 border-emerald-500 bg-emerald-950/15 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
                ⚡ Filtered view
              </p>
              <h2 className="mt-1 text-base font-bold text-zinc-100">
                Bills your reps are deciding
              </h2>
              <p className="mt-1 text-sm text-zinc-300">
                {committeeFilterErrorReason
                  ? <>Filter unavailable — {committeeFilterErrorReason}. Showing all bills below.</>
                  : committeeFilterCount === 0
                  ? <>No active bills are currently in committees where your reps sit. That can change quickly — check back tomorrow.</>
                  : <>Narrowed to <strong>{committeeFilterCount}</strong> active bill{committeeFilterCount === 1 ? "" : "s"} in committees one of your representatives sits on.</>}
              </p>
            </div>
            <Link
              href="/bills"
              className="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500"
            >
              Show all bills →
            </Link>
          </div>
        </div>
      )}

      {/* BoP-watch summary belongs next to the legislative bill tracker —
          they're the two parallel paths to a kratom ban. Bills = legislative
          (votes), BoP = administrative (rulemaking). Side-by-side gives
          advocates the full picture of where threats can come from. */}
      <div className="mb-6">
        <BopWatchSummary state={userState ?? undefined} />
      </div>

      <BillsBrowser bills={wantsCommitteeFilter && !committeeFilterErrorReason ? filteredBills : allBills} userState={userState} initialState={initialState} />
    </div>
  );
}
