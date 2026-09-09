import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BillsView } from "./BillsView";
import { BopWatchSummary } from "@/modules/bop/BopWatchSummary";

export const metadata = { title: "Bill tracker" };

/**
 * ⚠ FROZEN WINDOW — RESTORE TO 900 ON 2026-09-16. ⚠ (see tests/egress-freeze-expiry)
 *
 * Was force-dynamic. The bill snapshot below has been behind unstable_cache all
 * along; what actually forced a per-request render was the page reading
 * searchParams AND cookies — `?state=XX` seeded a filter and
 * `?filter=in-my-committees` resolved the signed-in viewer's representatives
 * and their committee assignments. Both now live client-side in BillsView,
 * with the per-viewer narrow fetched from /api/bills/my-committees.
 *
 * Beyond the egress saving: exceeding the Supabase free-tier cap RESTRICTS the
 * project rather than billing for it, and a dynamic route 500s in that state
 * while a prerendered one keeps serving from the CDN. /bills is the platform's
 * most valuable indexed content, so it is also the page we most want to
 * survive.
 */
export const revalidate = 604800; // 7d — frozen; normal is 900

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

export default async function BillsPage() {
  const allBills = await getBillsSnapshot();

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

      {/* BoP-watch summary belongs next to the legislative bill tracker —
          they're the two parallel paths to a kratom ban. Bills = legislative
          (votes), BoP = administrative (rulemaking). Side-by-side gives
          advocates the full picture of where threats can come from.
          National scope here: this page is the all-50-states tracker, and the
          state-scoped view lives on the State HQ. */}
      <div className="mb-6">
        <BopWatchSummary />
      </div>

      {/* Suspense is REQUIRED: BillsView calls useSearchParams(), and Next
          refuses to prerender a page that reads them outside a boundary. */}
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-zinc-900/50" />}>
        <BillsView bills={allBills} />
      </Suspense>
    </div>
  );
}
