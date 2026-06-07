import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rankActions, type RankableBill, type RankableCampaign } from "@/modules/district/rank";

/**
 * Compact dashboard gateway to /my-district: the user's state status (leaf +
 * 7-OH pills) + their single highest-priority action (reuses the same
 * rankActions used by the full hub). Always renders when state is set — it's
 * the entry point, so even "no campaigns" still shows status + the link.
 */
const TONE: Record<string, string> = {
  banned: "border-red-700/50 bg-red-950/30 text-red-200",
  restricted: "border-amber-700/50 bg-amber-950/25 text-amber-200",
  kcpa: "border-emerald-700/50 bg-emerald-950/25 text-emerald-200",
  protected: "border-emerald-700/50 bg-emerald-950/25 text-emerald-200",
  // "legal" = no protective law on the books → unprotected, not green.
  legal: "border-blue-700/50 bg-blue-950/30 text-blue-200",
  // "incoming" = protection approved but not yet in force.
  incoming: "border-teal-700/50 bg-teal-950/30 text-teal-200",
};

export async function MyDistrictWidget({
  userState,
  userLocality,
}: {
  userState: string;
  userLocality: string | null;
}) {
  const supabase = await createClient();
  const now = Date.now();

  const [statusRes, campaignsRes] = await Promise.all([
    supabase
      .from("state_status")
      .select("derived_leaf_status, derived_7oh_status, admin_leaf_status, admin_7oh_status")
      .eq("state", userState)
      .maybeSingle(),
    supabase
      .from("campaigns")
      .select("id, slug, title, blurb, state, bill_id, target_locality, created_at")
      .or(`state.eq.${userState},state.is.null`)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const campaigns = (campaignsRes.data as RankableCampaign[] | null) ?? [];
  const billIds = Array.from(new Set(campaigns.map((c) => c.bill_id).filter(Boolean))) as string[];
  const billsById = new Map<string, RankableBill>();
  if (billIds.length > 0) {
    const { data: bills } = await supabase
      .from("bills")
      .select("id, status, kratom_relevance, last_action_at, scope")
      .in("id", billIds);
    for (const b of (bills as RankableBill[] | null) ?? []) billsById.set(b.id, b);
  }
  const top = rankActions(campaigns, billsById, { userState, userLocality, now })[0] ?? null;

  const status = statusRes.data as
    | { derived_leaf_status: string | null; derived_7oh_status: string | null; admin_leaf_status: string | null; admin_7oh_status: string | null }
    | null;
  const leaf = status?.admin_leaf_status ?? status?.derived_leaf_status ?? null;
  const oh = status?.admin_7oh_status ?? status?.derived_7oh_status ?? null;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">your district</p>
          <h2 className="text-sm font-bold text-zinc-100">My district · {userState}</h2>
        </div>
        <Link href="/my-district" className="text-xs text-emerald-400 hover:underline">open →</Link>
      </div>
      <div className="space-y-3 px-4 py-3">
        {(leaf || oh) && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {leaf && <span className={`rounded border px-2 py-0.5 ${TONE[leaf] ?? "border-zinc-700 text-zinc-300"}`}>Leaf: {leaf}</span>}
            {oh && <span className={`rounded border px-2 py-0.5 ${TONE[oh] ?? "border-zinc-700 text-zinc-300"}`}>7-OH: {oh}</span>}
          </div>
        )}
        {top ? (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500">top action</p>
            <Link
              href={top.slug ? `/campaigns/${top.slug}` : "/campaigns"}
              className="mt-0.5 block text-sm font-medium text-zinc-100 hover:text-emerald-300"
            >
              {top.title}
            </Link>
            {top.reasons[0] && <p className="text-[11px] text-zinc-500">{top.reasons[0]}</p>}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No active campaigns in your area right now — you&apos;re clear.</p>
        )}
      </div>
    </section>
  );
}
