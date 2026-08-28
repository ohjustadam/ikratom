import Link from "next/link";

/**
 * Segment-level 404 for /briefings/*.
 *
 * WHEN THIS ACTUALLY RENDERS — narrower than you might assume. An unknown slug
 * is rejected by the ROUTER (`dynamicParams = false` in [slug]/page.tsx) before
 * this segment is entered, and Next serves the ROOT not-found for that. Verified
 * by request: /briefings/does-not-exist returns 404 with "Lost in the war room".
 *
 * What reaches here is the page's own `notFound()` guard — i.e. a briefing that
 * existed at build time but is gone when the route re-renders (these pages carry
 * a revalidate window, so that is a real path, not a hypothetical).
 *
 * Kept because it costs nothing and is friendlier than the site-wide 404 for a
 * reader who wanted a specific briefing.
 */
export default function BriefingNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-emerald-400">404</p>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">That briefing isn&apos;t here.</h1>
      <p className="mt-4 max-w-md text-zinc-400">
        It may have been renamed, or the link may be truncated. Every briefing we
        publish is listed below — including the per-state ones, regenerated nightly.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/briefings"
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          All briefings
        </Link>
        <Link
          href="/briefings/state"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          State briefings
        </Link>
      </div>
    </div>
  );
}
