import { createClient } from "@/lib/supabase/server";

/**
 * Bills the user has personally taken action on, with each bill's
 * current status. Answers "did my email matter?" — they see the bill's
 * journey from introduced → committee → vote → enacted/dead, with their
 * action date stamped.
 *
 * Capped at 8 most-recent battles. Empty state directs to /campaigns.
 */
export async function MyBattlesWidget({ userId }: { userId: string }) {
  const supabase = await createClient();

  // campaign_actions has campaign_id + sent_at. We join through campaigns
  // → bills to get current status. supabase-js returns nested relations
  // as arrays even when the FK is one-to-one; cast and pick [0].
  const { data: actionsRaw } = await supabase
    .from("campaign_actions")
    .select(
      "id, campaign_id, sent_at, method, campaigns:campaign_id(id, title, slug, bill_id, bills:bill_id(id, state, bill_number, title, status, kratom_relevance))",
    )
    .eq("user_id", userId)
    // Campaign actions only — direct (non-campaign) compose sends carry a null
    // campaign_id (migration 0232) and have no bill "battle". Without this
    // filter, recent direct sends fill the limit(8) window and the user's real
    // campaign battles get dropped by the .filter(b => b.bill) below.
    .not("campaign_id", "is", null)
    .order("sent_at", { ascending: false })
    .limit(8);

  type Bill = { id: string; state: string; bill_number: string; title: string | null; status: string | null; kratom_relevance: string | null };
  type Campaign = { id: string; title: string; slug: string; bill_id: string | null; bills: Bill | Bill[] | null };
  type Action = { id: string; sent_at: string; method: string | null; campaigns: Campaign | Campaign[] | null };

  const battles = ((actionsRaw ?? []) as unknown as Action[])
    .map((a) => {
      const camp = Array.isArray(a.campaigns) ? a.campaigns[0] : a.campaigns;
      const bill = Array.isArray(camp?.bills) ? camp?.bills[0] : camp?.bills ?? null;
      return {
        action_id: a.id,
        sent_at: a.sent_at,
        method: a.method,
        bill: bill ?? null,
      };
    })
    .filter((b) => b.bill);

  if (battles.length === 0) return null;

  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950/40">
      <div className="flex items-end justify-between border-b border-zinc-900 px-4 py-2.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            mission record
          </p>
          <h2 className="text-sm font-bold text-zinc-100">My battles</h2>
        </div>
        <a href="/campaigns" className="text-xs text-emerald-400 hover:underline">
          take more →
        </a>
      </div>
      <ul className="divide-y divide-zinc-900">
        {battles.map((b) => {
          const bill = b.bill!;
          const statusTone =
            bill.status === "enacted"
              ? "bg-red-950/40 text-red-300"
              : bill.status === "dead"
              ? "bg-emerald-950/40 text-emerald-300"
              : "bg-amber-950/40 text-amber-300";
          return (
            <li key={b.action_id}>
              <a
                href={`/bills/${bill.id}`}
                className="block px-4 py-2.5 text-sm hover:bg-zinc-950/60"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                    {bill.state} {bill.bill_number}
                  </span>
                  {bill.status && (
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusTone}`}>
                      {bill.status.replace(/_/g, " ")}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-zinc-600">
                    {b.method === "call" ? "📞" : "📨"} {new Date(b.sent_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-300">
                  {bill.title ?? "(untitled bill)"}
                </p>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
