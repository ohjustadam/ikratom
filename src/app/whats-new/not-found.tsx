import Link from "next/link";

/**
 * Segment-level 404 for /whats-new/*.
 *
 * Context: a missing note used to `redirect("/whats-new")`. That was kind — a
 * push notification can point at a note that never landed — but it answered
 * HTTP 200 at a URL that does not exist, so crawlers indexed it as a duplicate
 * of the changelog. The route now rejects unknown slugs at the router, which
 * returns an honest 404.
 *
 * ⚠️ That router-level rejection renders the ROOT not-found, NOT this file, so
 * a stale push link now lands on the generic site 404 rather than the changelog.
 * That is a deliberate trade: correct status over the softer landing. This file
 * covers the remaining case — the page's own `notFound()` guard, for a note that
 * existed at build time and is gone when the route re-validates.
 */
export default function PatchNoteNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="font-mono text-sm uppercase tracking-widest text-emerald-400">404</p>
      <h1 className="mt-4 text-3xl font-bold sm:text-4xl">That update isn&apos;t here.</h1>
      <p className="mt-4 max-w-md text-zinc-400">
        If you followed a notification, the note may have been renamed since it
        was sent. Everything we&apos;ve shipped is on the changelog.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/whats-new"
          className="rounded-md bg-emerald-500 px-5 py-2 font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          All updates
        </Link>
        <Link
          href="/"
          className="rounded-md border border-zinc-700 px-5 py-2 font-semibold hover:border-emerald-500"
        >
          Home
        </Link>
      </div>
    </div>
  );
}
