import Link from "next/link";
import { redirect } from "next/navigation";
import { getCreatorContext } from "@/modules/admin/actions";

export const metadata = { title: "Add to library" };

/**
 * /admin/library/new — type-picker landing.
 *
 * Replaces the previous single-form-for-everything flow. Most library
 * additions are videos or articles that can be auto-filled from a
 * URL. The picker routes those to /admin/library/new/quick (URL-paste
 * with metadata fetch). Books / docs / manual entries still get the
 * full form at /admin/library/new/manual.
 */
export default async function NewLibraryItemLanding() {
  const ctx = await getCreatorContext({ require: "edit_library" });
  if (!ctx.ok) redirect("/dashboard");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/library" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Library
      </a>
      <header className="mt-2 mb-8">
        <h1 className="text-3xl font-bold">Add to library</h1>
        <p className="mt-2 text-sm text-zinc-400">
          What are you adding? Pick a type and we&apos;ll fetch as much info as we can automatically — you just review and save.
        </p>
      </header>

      {/* URL-auto-fill paths */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-emerald-300">
          ⚡ Auto-fill from URL
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          Paste a link, we fetch title + description + cover image automatically.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TypeCard
            href="/admin/library/new/quick?type=video"
            emoji="📺"
            title="YouTube video"
            body="Paste a YouTube URL → we pull title, channel, thumbnail, and AI-generate a description."
            highlight
          />
          <TypeCard
            href="/admin/library/new/quick?type=article"
            emoji="📄"
            title="Article / blog post"
            body="Paste any article URL → we read its Open Graph tags for title, description, author, cover."
            highlight
          />
          <TypeCard
            href="/admin/library/new/quick?type=audio"
            emoji="🎙️"
            title="Podcast episode"
            body="Spotify / Apple / Substack podcast URL → metadata fetched automatically."
          />
          <TypeCard
            href="/admin/library/new/quick?type=document"
            emoji="📑"
            title="Research / report URL"
            body="Public PDF or research-paper link with web preview metadata."
          />
        </div>
      </section>

      {/* Manual full-form path */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Manual entry
        </h2>
        <p className="mb-4 text-xs text-zinc-500">
          For books, original content, or anything without a public URL — the full form, every field manual.
        </p>
        <TypeCard
          href="/admin/library/new/manual"
          emoji="✍"
          title="Manual entry (full form)"
          body="All fields manually. Required for books, original write-ups, transcripts, or sources where the auto-fetch comes back empty."
        />
      </section>
    </div>
  );
}

function TypeCard({
  href,
  emoji,
  title,
  body,
  highlight,
}: {
  href: string;
  emoji: string;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  const cls = highlight
    ? "border-2 border-emerald-500/60 bg-emerald-950/15 hover:border-emerald-400 hover:bg-emerald-950/25"
    : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  return (
    <Link href={href} className={`block rounded-lg p-5 transition ${cls}`}>
      <p className="text-2xl leading-none">{emoji}</p>
      <h3 className="mt-2 text-base font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-xs text-zinc-400">{body}</p>
    </Link>
  );
}
