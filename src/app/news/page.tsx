import { listAllRecentNews } from "@/modules/news/actions";
import { NewsList } from "./NewsList";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export const metadata = { title: "Kratom news" };

/**
 * ISR, 10 minutes.
 *
 * WHY (2026-09-08 egress emergency). This page used to open a cookie-bound
 * Supabase client purely to read the visitor's home state for the "your state"
 * filter. A cookie read opts the route out of caching entirely, so EVERY hit —
 * and the overwhelming majority of hits are crawlers — re-ran the 250-row news
 * query against Supabase. Measured: 99.8% of our Supabase egress is PostgREST,
 * ~19k requests/day, against a 5 GB monthly cap that STOPS the site when hit.
 *
 * The per-user bit now comes from the single /api/me chrome read that real
 * browsers already make (see src/app/api/me/route.ts). Crawlers don't run JS,
 * so they never make it — which is the whole point.
 *
 * WHY 1800 AND NOT 600. This query is the single fattest read in the app:
 * MEASURED at 0.293 MB (250 rows x 1,172 B). ISR is only a win when traffic
 * exceeds the revalidation rate, because you pay one render per window whether
 * anyone visits or not:
 *     revalidate=600  -> 144 renders/day = 42 MB/day
 *     revalidate=1800 ->  48 renders/day = 14 MB/day
 *     revalidate=3600 ->  24 renders/day =  7 MB/day
 * A 10-minute window would have been WORSE than staying dynamic on a quiet day.
 * 30 minutes is comfortably fresher than the news pipeline itself, which runs
 * every 2 hours, and live search still goes through the searchNews server
 * action, so nothing a reader can actually notice goes stale.
 */
export const revalidate = 1800;

export default async function NewsPage() {
  // Bigger fetch so client-side pagination has room. Filtering + sorting
  // is cheap at 200 rows; the bottleneck is the DB roundtrip.
  const items = await listAllRecentNews(250);

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

      <NewsList items={items} />
    </div>
  );
}
