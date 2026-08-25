import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import Link from "next/link";
import { notFound } from "next/navigation";
import { frontmatterString } from "@/lib/frontmatter";

export const metadata = { title: "Patch note" };

const NOTES_DIR = path.join(process.cwd(), "src", "content", "patch-notes");

/**
 * Enumerate the patch notes at build time; reject anything else at the router.
 *
 * Previously a missing slug called `redirect("/whats-new")` — kind to a reader
 * who followed a push notification for a note that never landed, but it served
 * the changelog index under HTTP 200 at a bogus URL, which is a soft redirect:
 * crawlers index the junk URL as duplicate content. The status could not be
 * fixed in place, because the root `src/app/loading.tsx` Suspense boundary
 * commits 200 before this component runs (proven by removing it — the route
 * answered 404 again).
 *
 * `dynamicParams = false` moves the miss to the router, which returns a true
 * 404. The kindness is preserved by ../not-found.tsx, which points at the
 * changelog exactly like the old redirect did — now with an honest status.
 *
 * Safe because every note's frontmatter `slug` equals its filename (verified
 * across all 40), which is what the index links to.
 */
export function generateStaticParams() {
  if (!fs.existsSync(NOTES_DIR)) return [];
  return fs
    .readdirSync(NOTES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/\.md$/, "") }));
}

export const dynamicParams = false;

export default async function PatchNotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = NOTES_DIR;
  const filePath = path.join(dir, `${slug}.md`);
  // Unreachable for unknown slugs now (the router rejects them), but kept as a
  // guard in case a file is deleted between build and request.
  if (!fs.existsSync(filePath)) notFound();

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const title = frontmatterString(data.title) ?? slug;
  const published = frontmatterString(data.published);
  const summary = frontmatterString(data.summary);
  const totalCommits = typeof data.total_commits === "number" ? data.total_commits : null;

  const html = await marked.parse(content, { gfm: true, breaks: false });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <Link href="/whats-new" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← What's new
      </Link>
      <header className="mt-2 mb-6 border-b border-zinc-800 pb-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Patch note
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
        {(published || totalCommits != null) && (
          <p className="mt-2 font-mono text-xs text-zinc-500">
            {published}{totalCommits != null && ` · ${totalCommits} commits`}
          </p>
        )}
        {summary && <p className="mt-3 text-sm text-zinc-300">{summary}</p>}
      </header>
      <article className="briefing-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
