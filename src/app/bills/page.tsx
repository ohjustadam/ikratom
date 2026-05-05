import { createClient } from "@/lib/supabase/server";
import { BillsBrowser } from "./BillsBrowser";

export const metadata = { title: "Bill tracker" };

export default async function BillsPage() {
  const supabase = await createClient();
  const { data: bills } = await supabase
    .from("bills")
    .select("id, state, bill_number, title, summary, status, kratom_relevance, last_action, last_action_at, source_url")
    .eq("active", true)
    .order("last_action_at", { ascending: false, nullsFirst: false })
    .limit(500);

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

      <BillsBrowser bills={bills ?? []} userState={userState} />
    </div>
  );
}
