import fs from "fs";
import path from "path";
import matter from "gray-matter";

export const metadata = { title: "Policy briefings" };

/**
 * Briefings index — every briefing in /briefings/*.md is auto-discovered
 * and listed. Each one renders at /briefings/<slug> AND has a downloadable
 * PDF at /briefings/<slug>.pdf (built via `npm run build:briefing-pdf`).
 *
 * No CMS, no DB — the markdown file IS the source of truth. Drop a new
 * .md file in briefings/, run the PDF builder, commit. The list updates
 * automatically.
 */
export default function BriefingsIndexPage() {
  const briefingsDir = path.join(process.cwd(), "briefings");
  const files = fs.existsSync(briefingsDir)
    ? fs.readdirSync(briefingsDir).filter((f) => f.endsWith(".md"))
    : [];

  const briefings = files
    .map((f) => {
      const src = fs.readFileSync(path.join(briefingsDir, f), "utf8");
      const { data } = matter(src);
      const slug = f.replace(/\.md$/, "");
      return {
        slug,
        title: (data.title as string) ?? slug,
        subtitle: (data.subtitle as string) ?? null,
        published: (data.published as string) ?? null,
        readTime: (data.read_time as string) ?? null,
        audience: (data.audience as string) ?? null,
      };
    })
    .sort((a, b) => (a.published && b.published ? (a.published < b.published ? 1 : -1) : 0));

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Policy briefings
        </p>
        <h1 className="mt-2 text-4xl font-bold">Federal &amp; state policy, decoded for advocates</h1>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          Every briefing is freely shareable. PDF versions are linked on each one
          for distribution to industry leaders, legislators, or advocacy groups.
        </p>
      </header>

      {briefings.length === 0 ? (
        <p className="text-zinc-500">No briefings yet.</p>
      ) : (
        <ul className="space-y-4">
          {briefings.map((b) => (
            <li key={b.slug} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-6 hover:border-emerald-500">
              <a href={`/briefings/${b.slug}`} className="block">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {b.published && (
                    <span className="font-mono text-zinc-500">{b.published}</span>
                  )}
                  {b.audience && (
                    <span className="rounded bg-emerald-950/30 px-2 py-0.5 text-emerald-300">
                      {b.audience}
                    </span>
                  )}
                  {b.readTime && (
                    <span className="text-zinc-500">{b.readTime} read</span>
                  )}
                </div>
                <h2 className="mt-2 text-xl font-bold leading-tight">{b.title}</h2>
                {b.subtitle && (
                  <p className="mt-1 text-sm text-zinc-400">{b.subtitle}</p>
                )}
              </a>
              <div className="mt-3 flex gap-2 text-xs">
                <a
                  href={`/briefings/${b.slug}`}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-emerald-400"
                >
                  Read briefing →
                </a>
                <a
                  href={`/briefings/${b.slug}.pdf`}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-zinc-200 hover:border-emerald-500"
                  download
                >
                  ↓ Download PDF
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
