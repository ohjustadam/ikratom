import Link from "@/components/Link";
import { listPatchNotes } from "@/lib/patch-notes";

export const metadata = {
  title: "What's new — platform changelog",
  description: "Daily updates on what we're building. Every feature, fix, and improvement, with links to the commits.",
};

/**
 * /whats-new — public changelog.
 *
 * Reads src/lib/patch-notes.ts, which merges the markdown back-catalogue with
 * the `patch_notes` table (migration 0250).
 *
 * ISR, not force-dynamic. Publishing still takes effect immediately, because
 * setPatchNoteStatus calls revalidatePath on this route — on-demand
 * revalidation gives the "no deploy needed" property without paying a database
 * render per request. That matters here: this page is public and crawlable,
 * and a dynamic public page is what the September 2026 egress incident was
 * made of. The 900s window is only the backstop for a change that arrives
 * without passing through the admin action.
 */
export const revalidate = 900;

export default async function WhatsNewIndex() {
  const notes = await listPatchNotes();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📰 What&apos;s new
        </p>
        <h1 className="mt-2 text-4xl font-bold">Platform changelog</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          New features and fixes you can use. We post here when something changes
          for you.
        </p>
      </header>

      {notes.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          First patch note coming soon.
        </p>
      ) : (
        <ul className="space-y-4">
          {notes.map((n) => (
            <li key={n.slug} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 hover:border-emerald-500">
              <Link href={`/whats-new/${n.slug}`} className="block">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {n.published && <span className="font-mono text-zinc-500">{n.published}</span>}
                </div>
                <h2 className="mt-2 text-xl font-bold leading-tight">{n.title}</h2>
                {n.summary && <p className="mt-1 text-sm text-zinc-400">{n.summary}</p>}
                <p className="mt-2 text-xs text-emerald-400">Read all changes →</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
