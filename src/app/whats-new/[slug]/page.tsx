import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { marked } from "marked";
import Link from "next/link";
import { notFound } from "next/navigation";

export const metadata = { title: "Patch note" };

export default async function PatchNotePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dir = path.join(process.cwd(), "src", "content", "patch-notes");
  const filePath = path.join(dir, `${slug}.md`);
  if (!fs.existsSync(filePath)) notFound();

  const raw = fs.readFileSync(filePath, "utf8");
  const { data, content } = matter(raw);

  const toStr = (v: unknown): string | null => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
  };
  const title = toStr(data.title) ?? slug;
  const published = toStr(data.published);
  const summary = toStr(data.summary);
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
