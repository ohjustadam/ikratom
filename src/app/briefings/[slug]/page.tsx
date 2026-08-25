import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import matter from "gray-matter";
import { marked } from "marked";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";
import { AudioReader } from "@/components/AudioReader";
import { frontmatterString } from "@/lib/frontmatter";
import { CopyShareLinkButton } from "./CopyShareLinkButton";
import { briefingAudioScript } from "@/lib/briefing-audio";

import Link from "next/link";
const BRIEFINGS_DIR = path.join(process.cwd(), "src", "content", "briefings");

/**
 * Enumerate the briefings at build time, and refuse anything else.
 *
 * This is a SOFT-404 FIX, not a perf tweak. `notFound()` inside the page could
 * not set a 404 status: the root `src/app/loading.tsx` wraps every route in a
 * Suspense boundary, so Next streams the shell — committing HTTP 200 — before
 * the page body ever runs. Google treats a 200 that says "not found" as a real
 * page and indexes the junk URL. Verified by experiment: temporarily removing
 * loading.tsx made this route answer 404 again.
 *
 * Removing loading.tsx is not an option (it is what stops ~200 dynamic pages
 * painting a blank screen in the mobile WebView). So the miss has to be caught
 * EARLIER than rendering. With `dynamicParams = false` an unlisted slug is
 * rejected by the router itself, which is the same path an unmatched URL takes
 * — and that path still returns a true 404 with the Suspense boundary in place.
 *
 * Bonus: the known slugs prerender instead of rendering per request.
 */
export function generateStaticParams() {
  if (!fs.existsSync(BRIEFINGS_DIR)) return [];
  return fs
    .readdirSync(BRIEFINGS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/\.md$/, "") }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]+$/.test(slug)) return { title: "Briefing" };
  const file = path.join(process.cwd(), "src", "content", "briefings", `${slug}.md`);
  if (!fs.existsSync(file)) return { title: "Briefing" };
  const { data } = matter(fs.readFileSync(file, "utf8"));
  const title = frontmatterString(data.title) ?? "Briefing";
  // `||` not `??` on purpose: a blank subtitle is as useless as a missing
  // one, and must fall through to the next candidate rather than shipping
  // an empty meta description.
  const description =
    frontmatterString(data.subtitle)?.trim() ||
    frontmatterString(data.description)?.trim() ||
    "Print-friendly kratom advocacy briefing — short read with talking points + sources.";
  const base = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const url = `${base}/briefings/${slug}`;
  return {
    title,
    description,
    openGraph: { type: "article", title, description, url, siteName: "iKratom" },
    twitter: { card: "summary_large_image", title, description },
    alternates: { canonical: url },
  };
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
  const file = path.join(process.cwd(), "src", "content", "briefings", `${slug}.md`);
  if (!fs.existsSync(file)) notFound();

  const src = fs.readFileSync(file, "utf8");
  const { data, content } = matter(src);
  const html = await marked.parse(content, { gfm: true, breaks: false });

  // Coerce frontmatter at the boundary — an unquoted YAML date arrives
  // here as a Date and would render as "Fri May 08 2026 19:00:00 GMT-0500".
  const title = frontmatterString(data.title) ?? "Briefing";
  const subtitle = frontmatterString(data.subtitle);
  const published = frontmatterString(data.published);
  const audience = frontmatterString(data.audience);
  const readTime = frontmatterString(data.read_time);

  // Spoken script for "Listen". Built from the markdown rather than the
  // rendered HTML so visual chrome (cover slab, status cards, citation
  // tables, inline SVG) is dropped instead of narrated as fragments.
  const audioScript = briefingAudioScript({ title, subtitle, published, content });

  // PDF availability check — built artifacts live in /public/briefings/.
  const pdfPath = path.join(process.cwd(), "public", "briefings", `${slug}.pdf`);
  const pdfExists = fs.existsSync(pdfPath);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <Link href="/briefings" className="text-xs text-zinc-500 hover:text-emerald-400">
          ← All briefings
        </Link>
        <PageShareWithAttribution
          path={`/briefings/${slug}`}
          title={title}
          summary={subtitle ?? "Kratom advocacy briefing — talking points + sources."}
        />
      </div>

      <header className="mt-3 mb-6 border-b border-zinc-800 pb-6">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {published && (
            <span className="rounded bg-emerald-950/40 px-2 py-1 font-mono text-emerald-300">
              {published}
            </span>
          )}
          {audience && (
            <span className="text-zinc-400">For: {audience}</span>
          )}
          {readTime && (
            <span className="text-zinc-500">{readTime} read</span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 text-base text-zinc-400">{subtitle}</p>
        )}
        {audioScript && (
          <div className="mt-4">
            <AudioReader
              id={`briefing-${slug}`}
              text={audioScript}
              label="Listen to this briefing"
            />
          </div>
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
          <CopyShareLinkButton url={`https://www.ikratom.org/briefings/${slug}`} />
        </div>
      </header>

      {/* Render markdown — wrapped in .briefing-md for scoped typography */}
      <article
        className="briefing-md text-zinc-200"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
