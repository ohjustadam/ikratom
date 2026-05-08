import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import { marked } from "marked";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return { title: "Briefing" };
  const file = path.join(process.cwd(), "briefings", `${slug}.md`);
  if (!fs.existsSync(file)) return { title: "Briefing" };
  const { data } = matter(fs.readFileSync(file, "utf8"));
  return { title: (data.title as string) ?? "Briefing" };
}

/**
 * Render a briefing markdown file as a styled page on the iKratom site.
 *
 * The .md file is the source of truth — the same file is fed to
 * `npm run build:briefing-pdf` to generate the printable PDF. Web
 * styling here is dark-mode (consistent with the rest of the site);
 * PDF styling is light-mode (better for print + email forwarding).
 */
export default async function BriefingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) notFound();
  const file = path.join(process.cwd(), "briefings", `${slug}.md`);
  if (!fs.existsSync(file)) notFound();

  const src = fs.readFileSync(file, "utf8");
  const { data, content } = matter(src);
  const html = await marked.parse(content, { gfm: true, breaks: false });

  // PDF availability check — built artifacts live in /public/briefings/.
  const pdfPath = path.join(process.cwd(), "public", "briefings", `${slug}.pdf`);
  const pdfExists = fs.existsSync(pdfPath);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <a href="/briefings" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← All briefings
      </a>

      <header className="mt-3 mb-6 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {data.published && (
            <span className="rounded bg-emerald-950/40 px-2 py-1 font-mono text-emerald-300">
              {String(data.published)}
            </span>
          )}
          {data.audience && (
            <span className="text-zinc-400">For: {String(data.audience)}</span>
          )}
          {data.read_time && (
            <span className="text-zinc-500">{String(data.read_time)} read</span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
          {String(data.title ?? "Briefing")}
        </h1>
        {data.subtitle && (
          <p className="mt-2 text-base text-zinc-400">{String(data.subtitle)}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {pdfExists && (
            <a
              href={`/briefings/${slug}.pdf`}
              download
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
            >
              ↓ Download PDF
            </a>
          )}
          <button
            type="button"
            data-share-url={`https://www.ikratom.org/briefings/${slug}`}
            className="briefing-share-btn inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 hover:border-emerald-500"
          >
            🔗 Copy share link
          </button>
        </div>
      </header>

      {/* Render markdown — wrapped in .briefing-md for scoped typography */}
      <article
        className="briefing-md text-zinc-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />

      {/* Tiny client script for the share button — avoids a separate
          client component file for one trivial interaction. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.querySelectorAll('.briefing-share-btn').forEach((btn) => {
              btn.addEventListener('click', async () => {
                const url = btn.getAttribute('data-share-url');
                if (!url) return;
                try {
                  await navigator.clipboard.writeText(url);
                  const orig = btn.innerText;
                  btn.innerText = '✓ Copied!';
                  setTimeout(() => { btn.innerText = orig; }, 1500);
                } catch (e) { /* noop */ }
              });
            });
          `,
        }}
      />
    </div>
  );
}
