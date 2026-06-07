import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { PendingQueueClient } from "./PendingQueueClient";
import { CampaignAutoApprovePolicyPanel } from "./CampaignAutoApprovePolicyPanel";
import { getCampaignAutoApprovePolicy, listRecentAutoDecisions } from "@/modules/admin/campaign-autoapprove-actions";

export const metadata = { title: "Campaigns awaiting review" };
export const dynamic = "force-dynamic";

type SearchParams = {
  state?: string;
  q?: string;
  has_bill?: string;
  sort?: string;
  show_superseded?: string;
  show_rejected?: string;
};

export type PendingRow = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  bill_id: string | null;
  mobilization_type: string | null;
  auto_generated: boolean | null;
  review_state: string | null;
  reviewed_by: string | null;
  review_reason: string | null;
  created_at: string;
  bills:
    | { bill_number: string; status: string | null; kratom_relevance: string | null; relevance_confidence: number | null; official_url: string | null }[]
    | { bill_number: string; status: string | null; kratom_relevance: string | null; relevance_confidence: number | null; official_url: string | null }
    | null;
};

export default async function PendingCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");
  const sp = await searchParams;

  const stateFilter = (sp.state ?? "").toUpperCase().slice(0, 4) || null;
  const search = (sp.q ?? "").trim().slice(0, 80) || null;
  const hasBillFilter = sp.has_bill === "1" ? true : sp.has_bill === "0" ? false : null;
  const showSuperseded = sp.show_superseded === "1";
  const showRejected = sp.show_rejected === "1";
  const sortKey = (() => {
    switch (sp.sort) {
      case "title-asc": return { col: "title", asc: true };
      case "title-desc": return { col: "title", asc: false };
      case "state": return { col: "state", asc: true };
      case "oldest": return { col: "created_at", asc: true };
      default: return { col: "created_at", asc: false };
    }
  })();

  const supabase = await createClient();
  let q = supabase
    .from("campaigns")
    .select(
      "id, slug, title, blurb, state, bill_id, mobilization_type, auto_generated, " +
      "review_state, reviewed_by, review_reason, created_at, " +
      "bills(bill_number, status, kratom_relevance, relevance_confidence, official_url)",
      { count: "exact" }
    );

  const wantStates = ["pending_review"];
  if (showSuperseded) wantStates.push("superseded");
  if (showRejected) wantStates.push("rejected");
  q = wantStates.length === 1
    ? q.eq("review_state", wantStates[0])
    : q.in("review_state", wantStates);
  if (stateFilter === "NONE") {
    q = q.is("state", null);
  } else if (stateFilter) {
    q = q.eq("state", stateFilter);
  }
  if (search) {
    q = q.ilike("title", `%${search}%`);
  }
  if (hasBillFilter === true) {
    q = q.not("bill_id", "is", null);
  } else if (hasBillFilter === false) {
    q = q.is("bill_id", null);
  }
  q = q.order(sortKey.col, { ascending: sortKey.asc }).limit(500);

  const { data: rows, count } = await q;

  // State-count breakdown for the filter pills (pending only — separate
  // from the main query so it stays unaffected by the user's other filters).
  const { data: stateRows } = await supabase
    .from("campaigns")
    .select("state")
    .eq("review_state", "pending_review")
    .limit(5000);
  const byState = new Map<string, number>();
  for (const r of stateRows ?? []) {
    const k = r.state ?? "NONE";
    byState.set(k, (byState.get(k) ?? 0) + 1);
  }

  // Engine policy + shadow/live decision ledger for the owner panel. Both reads
  // are defensive (return safe defaults / [] if migrations 0182/0183 aren't
  // applied yet) so this page renders even before the schema lands.
  const [policy, recentDecisions] = await Promise.all([
    getCampaignAutoApprovePolicy(),
    listRecentAutoDecisions(30),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Admin
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Campaigns awaiting review</h1>
        <p className="mt-2 text-sm text-zinc-400">
          <strong className="text-zinc-200">{count ?? 0}</strong> match{count === 1 ? "" : "es"} the current filter
          {showSuperseded && " (incl. superseded)"}. Auto-generated campaigns surface
          here for admin approval — bulk-select with the checkbox column, then use
          the action bar at the bottom.
        </p>
      </header>

      <CampaignAutoApprovePolicyPanel
        initial={policy}
        isOwner={ctx.isOwner}
        recentDecisions={recentDecisions}
      />

      <PendingQueueClient
        rows={(rows ?? []) as unknown as PendingRow[]}
        totalCount={count ?? 0}
        stateCounts={Array.from(byState.entries()).sort((a, b) => b[1] - a[1])}
        currentParams={{
          state: stateFilter,
          q: search,
          hasBill: hasBillFilter,
          sort: sp.sort ?? "newest",
          showSuperseded,
          showRejected,
        }}
      />
    </div>
  );
}
