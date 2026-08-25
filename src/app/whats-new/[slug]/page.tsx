import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import Link from "next/link";
import { redirect } from "next/navigation";
import { frontmatterString } from "@/lib/frontmatter";

export const metadata = { title: "Patch note" };

export default async function PatchNotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = path.join(process.cwd(), "src", "content", "patch-notes");
  const filePath = path.join(dir, `${slug}.md`);
  // A missing slug usually means a broadcast notification pointed at a patch
  // note that never landed in the repo (see the weekly-digest cron fix). Send
  // the reader to the changelog index instead of a dead 404.
  if (!fs.existsSync(filePath)) redirect("/whats-new");

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
