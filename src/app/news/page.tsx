import { createClient } from "@/lib/supabase/server";
import { listAllRecentNews } from "@/modules/news/actions";
import { NewsList } from "./NewsList";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = { title: "Kratom news" };

export default async function NewsPage() {
  // Bigger fetch so client-side pagination has room. Filtering + sorting
  // is cheap at 200 rows; the bottleneck is the DB roundtrip.
  const items = await listAllRecentNews(250);

  // User's state (for highlight)
  const supabase = await createClient();
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
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Kratom news</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Daily AI-curated news on kratom legislation, science, business, and enforcement.
            Federal coverage + per-state. Last 30 days.
          </p>
        </div>
        <PageShareWithAttribution
          path="/news"
          title="Kratom news — daily AI-curated"
          summary="Daily kratom legislation, science, business, and enforcement news. Federal + every state."
        />
      </header>

      <NewsList items={items} userState={userState} />
    </div>
  );
}
