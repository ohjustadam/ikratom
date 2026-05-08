import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMySavedSearches } from "@/modules/saved-searches/actions";
import { SavedSearchesPanel } from "./SavedSearchesPanel";

export const metadata = { title: "Saved searches" };

export default async function SavedSearchesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/account/saved-searches");

  const searches = await listMySavedSearches();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/account" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Account
      </a>
      <header className="mt-2 mb-6">
        <h1 className="text-3xl font-bold">Saved searches</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Save up to 10 alert rules. The daily cron checks for new bills matching
          each rule and notifies you of fresh matches.
        </p>
      </header>

      <SavedSearchesPanel initial={searches} />
    </div>
  );
}
