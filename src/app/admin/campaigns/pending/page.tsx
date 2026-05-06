import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";
import { createClient } from "@/lib/supabase/server";
import { ReviewActions } from "./ReviewActions";

export const metadata = { title: "Campaigns awaiting review" };
export const dynamic = "force-dynamic";

type Pending = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  state: string | null;
  bill_id: string | null;
  created_at: string;
  bills:
    | { bill_number: string; relevance_confidence: number | null; targets_natural_leaf: boolean | null; targets_synthetic_only: boolean | null; deep_analyzed_at: string | null; official_url: string | null; }[]
    | { bill_number: string; relevance_confidence: number | null; targets_natural_leaf: boolean | null; targets_synthetic_only: boolean | null; deep_analyzed_at: string | null; official_url: string | null; }
    | null;
};

export default async function PendingCampaignsPage() {
  const ctx = await getCreatorContext();
  if (!ctx.ok) redirect("/dashboard");

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("campaigns")
    .select(
      "id, slug, title, blurb, state, bill_id, created_at, " +
      "bills(bill_number, relevance_confidence, targets_natural_leaf, targets_synthetic_only, deep_analyzed_at, official_url)"
    )
    .eq("review_state", "pending_review")
    .order("created_at", { ascending: false })
    .limit(100);

  const items = (rows ?? []) as unknown as Pending[];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/admin" className="text-xs text-zinc-500 hover:text-emerald-400">← Admin</a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Campaigns awaiting review</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Auto-generated campaigns with medium-confidence classification or
          unconfirmed leaf-targeting. Approve to publish; reject to discard.
          Approved campaigns notify all matched users via the existing trigger.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-12 text-center text-sm text-zinc-500">
          <p className="text-3xl">✓</p>
          <p className="mt-2">No campaigns awaiting review.</p>
          <p className="mt-1 text-xs text-zinc-600">
            Auto-generated campaigns with confidence &ge; 0.85 + confirmed
            anti-leaf classification publish automatically.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {items.map((c) => {
            const bill = Array.isArray(c.bills) ? c.bills[0] : c.bills;
            const conf = bill?.relevance_confidence ?? null;
            const leaf = bill?.targets_natural_leaf;
            const synOnly = bill?.targets_synthetic_only;
            const deep = !!bill?.deep_analyzed_at;
            return (
              <li
                key={c.id}
                className="rounded-lg border border-amber-700/40 bg-amber-950/10 p-5"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
                    PENDING
                  </span>
                  {c.state && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {c.state}
                    </span>
                  )}
                  {bill?.bill_number && (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-300">
                      {bill.bill_number}
                    </span>
                  )}
                  {conf != null && (
                    <span className={`rounded px-1.5 py-0.5 ${conf >= 0.85 ? "bg-emerald-950/40 text-emerald-300" : "bg-zinc-900 text-zinc-400"}`}>
                      {Math.round(conf * 100)}% confidence
                    </span>
                  )}
                  {deep ? (
                    <>
                      {leaf === true && (
                        <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-red-300" title="Deep analysis confirmed bill targets natural leaf">
                          🚨 leaf
                        </span>
                      )}
                      {leaf === false && synOnly && (
                        <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-emerald-300" title="Deep analysis: synthetic-only bill, preserves leaf">
                          ✓ synthetic-only
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-zinc-500" title="Run npm run enrich:bills:deep to deep-analyze">
                      shallow only
                    </span>
                  )}
                  <span className="ml-auto text-zinc-500">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold">{c.title}</h3>
                {c.blurb && <p className="mt-1 text-sm text-zinc-300">{c.blurb}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href={`/bills/${c.bill_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:underline"
                  >
                    View bill detail →
                  </a>
                  {bill?.official_url && (
                    <a
                      href={bill.official_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-emerald-400 hover:underline"
                    >
                      ⭐ Official source ↗
                    </a>
                  )}
                  <a
                    href={`/admin/campaigns/${c.id}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-500 hover:text-emerald-400"
                  >
                    Edit before approving
                  </a>
                </div>
                <div className="mt-4">
                  <ReviewActions campaignId={c.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
