/**
 * Global route-loading fallback.
 *
 * Next renders this instantly (from the already-shipped shell) while a
 * dynamic segment's server component awaits its data. Before this existed,
 * navigating to any of the ~200 force-dynamic pages painted a BLANK screen
 * until the slowest Supabase query resolved — which, inside the Android/iOS
 * WebView wrapper, reads as a frozen app on launch (a common store-review
 * rejection). A route can still ship its own tailored loading.tsx; this is
 * the safety net for every route that doesn't.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8"
      aria-busy="true"
      aria-label="Loading"
    >
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-2/3 rounded bg-zinc-800/70" />
        <div className="h-4 w-1/2 rounded bg-zinc-800/50" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-lg border border-zinc-800 bg-zinc-900/40"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
