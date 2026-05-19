import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Markdown } from "@/components/Markdown";
import { TYPE_ICONS, TYPE_LABELS, type LibraryItemType } from "@/modules/library/types";
import { getCreatorContext } from "@/modules/admin/actions";
import { PageShareWithAttribution } from "@/components/PageShareWithAttribution";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("library_items")
    .select("title, description, summary, type, author, source_org")
    .eq("id", id)
    .single();
  if (!data) return { title: "Library" };
  const d = data as { title: string; description: string | null; summary: string | null; type: string | null; author: string | null; source_org: string | null };
  const title = d.title;
  const description = (d.description ?? d.summary ?? "").slice(0, 200) ||
    `${TYPE_LABELS[d.type as LibraryItemType] ?? "Resource"} in the iKratom library${d.author ? ` by ${d.author}` : ""}${d.source_org ? ` — ${d.source_org}` : ""}.`;
  const base = (process.env.APP_URL ?? "https://www.ikratom.org").replace(/\/+$/, "");
  const url = `${base}/library/${id}`;
  return {
    title,
    description,
    openGraph: { type: "article", title, description, url, siteName: "iKratom" },
    twitter: { card: "summary_large_image", title, description },
    alternates: { canonical: url },
  };
}

export default async function LibraryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: item } = await supabase
    .from("library_items")
    .select("*")
    .eq("id", id)
    .eq("active", true)
    .single();
  if (!item) notFound();

  const ctx = await getCreatorContext();
  const canEdit = ctx.ok;

  const typeLabel = TYPE_LABELS[item.type as LibraryItemType] ?? item.type;
  const typeIcon = TYPE_ICONS[item.type as LibraryItemType] ?? "•";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between">
        <a href="/library" className="text-xs text-zinc-500 hover:text-emerald-400">
          ← Library
        </a>
        <PageShareWithAttribution
          path={`/library/${item.id}`}
          title={item.title}
          summary={(item.description ?? item.summary ?? "").slice(0, 180) || `${typeLabel} in the iKratom library.`}
        />
      </div>
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-zinc-900 px-2 py-0.5 text-zinc-300">
            {typeIcon} {typeLabel}
          </span>
          {item.featured && (
            <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">
              ★ Featured
            </span>
          )}
        </div>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{item.title}</h1>
        {(item.author || item.source_org) && (
          <p className="mt-2 text-sm text-zinc-400">
            {[item.author, item.source_org].filter(Boolean).join(" · ")}
            {item.published_at && <span className="ml-2 text-zinc-600">· {item.published_at}</span>}
          </p>
        )}
        {canEdit && (
          <div className="mt-3">
            <a
              href={`/admin/library/${item.id}/edit`}
              className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:border-emerald-500"
            >
              Edit
            </a>
          </div>
        )}
      </header>

      {/* Embed (video/audio) */}
      {item.embed_html && (
        <div
          className="mb-6 aspect-video w-full overflow-hidden rounded-lg border border-zinc-800 [&_iframe]:h-full [&_iframe]:w-full"
          dangerouslySetInnerHTML={{ __html: item.embed_html }}
        />
      )}

      {/* Cover image (for books/articles when no embed) */}
      {!item.embed_html && item.cover_image_url && (
        <img
          src={item.cover_image_url}
          alt={item.title}
          loading="lazy"
          decoding="async"
          className="mb-6 max-h-96 w-full rounded-lg border border-zinc-800 object-cover"
        />
      )}

      {/* External link */}
      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-6 inline-block rounded-md border border-emerald-700/50 px-4 py-2 text-sm text-emerald-300 hover:border-emerald-500"
        >
          Open original source ↗
        </a>
      )}

      {/* Description */}
      {item.description && (
        <div className="mb-6 text-base text-zinc-300">{item.description}</div>
      )}

      {/* Summary (AI-generated for long-form) */}
      {item.summary && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Summary
          </h2>
          <Markdown>{item.summary}</Markdown>
        </section>
      )}

      {/* Full text (books, articles) */}
      {item.full_text && (
        <section className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Full text
          </h2>
          <Markdown>{item.full_text}</Markdown>
        </section>
      )}

      {/* Transcript (audio/video) */}
      {item.transcript && (
        <details className="mb-6 rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 hover:text-emerald-400">
            Transcript ({item.transcript.length.toLocaleString()} chars)
          </summary>
          <div className="mt-3">
            <Markdown>{item.transcript}</Markdown>
          </div>
        </details>
      )}

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-zinc-800 pt-4">
          {item.tags.map((t: string) => (
            <span key={t} className="rounded bg-zinc-900 px-2 py-1 text-xs text-zinc-400">
              #{t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
