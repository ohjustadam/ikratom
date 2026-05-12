import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Link from "next/link";

export const metadata = {
  title: "What's new — platform changelog",
  description: "Daily updates on what we're building. Every feature, fix, and improvement, with links to the commits.",
};

/**
 * /whats-new — public changelog.
 *
 * File-driven, same pattern as /briefings. Markdown files in
 * src/content/patch-notes/ are auto-discovered + listed newest first.
 *
 * Drafts come from scripts/generate-patch-note.mjs which reads recent
 * git log + groups by conventional-commit prefix.
 */
export default function WhatsNewIndex() {
  const dir = path.join(process.cwd(), "src", "content", "patch-notes");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
    : [];

  const notes = files
    .map((f) => {
      const { data } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
      const toStr = (v: unknown): string | null => {
        if (v == null) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        return String(v);
      };
      return {
        slug: toStr(data.slug) ?? f.replace(/\.md$/, ""),
        title: toStr(data.title) ?? f,
        summary: toStr(data.summary),
        published: toStr(data.published),
        totalCommits: typeof data.total_commits === "number" ? data.total_commits : null,
      };
    })
    .sort((a, b) => (a.published && b.published ? (a.published < b.published ? 1 : -1) : 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📰 What's new
        </p>
        <h1 className="mt-2 text-4xl font-bold">Platform changelog</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          We ship updates daily. Every feature, fix, and improvement is logged
          here with links to the underlying commits — full transparency on what
          this platform is becoming.
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
                  {n.totalCommits != null && (
                    <span className="rounded bg-emerald-950/30 px-2 py-0.5 text-emerald-300">
                      {n.totalCommits} commits
                    </span>
                  )}
                </div>
                <h2 className="mt-2 text-xl font-bold leading-tight">{n.title}</h2>
                {n.summary && <p className="mt-1 text-sm text-zinc-400">{n.summary}</p>}
                <p className="mt-2 text-xs text-emerald-400">Read all changes →</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <p className="font-semibold text-zinc-300">Building in the open</p>
        <p className="mt-1">
          All code is auditable at{" "}
          <a href="https://github.com/ohjustadam/ikratom" className="text-emerald-400 hover:underline" target="_blank" rel="noopener noreferrer">
            github.com/ohjustadam/ikratom
          </a>
          . Each patch note links to the specific commits that landed.
        </p>
      </footer>
    </div>
  );
}
