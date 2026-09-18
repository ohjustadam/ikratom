import { marked } from "marked";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPatchNote, patchNoteFileSlugs } from "@/lib/patch-notes";

/**
 * A patch note, from either source (see src/lib/patch-notes.ts).
 *
 * ── Why dynamicParams is true now ─────────────────────────────────────────
 * This route used to set `dynamicParams = false` and enumerate the markdown
 * directory, so an unknown slug was rejected by the ROUTER with a true 404.
 * That was a deliberate fix: calling notFound() inside the component returns
 * HTTP 200, because the root src/app/loading.tsx Suspense boundary commits the
 * status before this component runs. A 200 on a bogus URL is a soft 404 and
 * crawlers index it as duplicate content.
 *
 * Notes published from the database cannot be enumerated at build time — that
 * is the entire point of migration 0250 — so the router can no longer be the
 * gate. The SEO property is preserved a different way: generateMetadata
 * resolves the note first and returns `robots: { index: false, follow: false }`
 * when there is nothing to show. A noindex soft-404 is not indexed, which is
 * what the original comment was actually protecting against.
 *
 * ── What this cost, measured ──────────────────────────────────────────────
 * generateStaticParams still lists the file back-catalogue, but the route no
 * longer prerenders: `next build` reports /whats-new/[slug] as ƒ (dynamic).
 * generateMetadata resolves the note through getPatchNote, which builds a
 * cookie-scoped Supabase client, and reading cookies opts the segment out of
 * static generation — so the 40 file notes are server-rendered per request
 * now, where before they were static HTML.
 *
 * That is a deliberate trade, not an oversight. Serving them statically again
 * would mean reading them without a Supabase client, which also means a
 * database row could never correct a file-era note — and being able to fix a
 * published note without touching the repo is the point of migration 0250.
 * These are low-traffic changelog pages; correctness beat the cache.
 */
export const dynamicParams = true;

export function generateStaticParams() {
  return patchNoteFileSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const note = await getPatchNote(slug);
  if (!note) {
    return { title: "Patch note not found", robots: { index: false, follow: false } };
  }
  return {
    title: note.title,
    description: note.summary ?? undefined,
  };
}

export default async function PatchNotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const note = await getPatchNote(slug);
  if (!note) notFound();

  const html = await marked.parse(note.bodyMd, { gfm: true, breaks: false });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/whats-new" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← What&apos;s new
      </Link>
      <header className="mt-2 mb-6 border-b border-zinc-800 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Patch note
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{note.title}</h1>
        {(note.published || note.totalCommits != null) && (
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {note.published}{note.totalCommits != null && ` · ${note.totalCommits} commits`}
          </p>
        )}
        {note.summary && <p className="mt-3 text-sm text-zinc-300">{note.summary}</p>}
      </header>
      <article className="briefing-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
