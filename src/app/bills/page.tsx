import { createClient } from "@/lib/supabase/server";
import { BillsBrowser } from "./BillsBrowser";

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
};

export default async function BillsPage() {
  const supabase = await createClient();
  const { data: billsRaw } = await supabase
    .from("bills")
    .select(
      "id, state, bill_number, title, summary, summary_ai, advocacy_callout, " +
      "status, kratom_relevance, relevance_confidence, last_action, last_action_at, source_url"
    )
    .eq("active", true)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(500);
  const bills = (billsRaw ?? []) as unknown as BillRow[];

  const { data: { user } } = await supabase.auth.getUser();
  let userState: string | null = null;
  if (user) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("state")
      .eq("id", user.id)
      .single();
    userState = prof?.state ?? null;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Bill tracker</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Every kratom + 7-OH bill across all 50 states. Synced from{" "}
          <a href="https://openstates.org" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
            OpenStates
          </a>
          {" "}— pro/anti/neutral relevance auto-classified from bill text patterns. Human review recommended.
        </p>
      </header>

      <BillsBrowser bills={bills} userState={userState} />
    </div>
  );
}
