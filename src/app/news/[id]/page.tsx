/**
 * /news/[id] — In-app news reader.
 *
 * Owner ask: keep users IN the app as much as possible. Each news card
 * now opens this page first; from here the user can read our AI summary
 * + extracted body excerpt + linked bill/alert/legislator context, and
 * if they want the full article they click "View at source".
 *
 * We don't store full article bodies (yet) — `body_extract_excerpt`
 * holds the ~500-char snippet we use for kratom-keyword verification,
 * which is enough for a "is this article relevant" preview but not a
 * full read. When we add full-body extraction (license-safe), this page
 * is the surface for it.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Params = { id: string };

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const sb = await createClient();
  const { data } = await sb.from("news_items").select("title,summary,source_name").eq("id", id).maybeSingle();
  if (!data) return { title: "Article not found" };
  return {
    title: `${data.title} — iKratom news`,
    description: data.summary ?? `Kratom news from ${data.source_name ?? "verified sources"}.`,
  };
}

export default async function NewsArticlePage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const sb = await createClient();

  // 1. The article itself, with linked bill if any. Supabase's
  // generated types for foreign-table embeds get confused at the
  // join boundary; cast through unknown to a hand-typed shape.
  type ArticleRow = {
    id: string;
    state: string | null;
    title: string;
    summary: string | null;
    body_extract_excerpt: string | null;
    body_paragraphs: string[] | null;
    media_urls: Array<{ type: string; url: string; embed_url?: string; video_id?: string; lead?: boolean }> | null;
    url: string;
    resolved_url: string | null;
    source_name: string | null;
    published_at: string | null;
    scraped_at: string | null;
    kratom_topic: string | null;
    ai_relevance_score: number | null;
    duplicate_count: number | null;
    policy_alert_id: string | null;
    bill_id: string | null;
    bills:
      | { id: string; bill_number: string; state: string; title: string | null; status: string | null; last_action: string | null; last_action_at: string | null; kratom_relevance: string | null }
      | Array<{ id: string; bill_number: string; state: string; title: string | null; status: string | null; last_action: string | null; last_action_at: string | null; kratom_relevance: string | null }>
      | null;
  };
  const { data: rawArticle } = await sb
    .from("news_items")
    .select(
      "id, state, title, summary, body_extract_excerpt, body_paragraphs, media_urls, url, resolved_url, " +
      "source_name, published_at, scraped_at, kratom_topic, ai_relevance_score, " +
      "duplicate_count, policy_alert_id, bill_id, " +
      "bills(id, bill_number, state, title, status, last_action, last_action_at, kratom_relevance)"
    )
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  const article = (rawArticle as unknown as ArticleRow | null) ?? null;
  if (!article) notFound();

  // 2. Sibling syndicated articles (same canonical → other states).
  const { data: siblings } = await sb
    .from("news_items")
    .select("id, state, source_name, published_at")
    .eq("duplicate_of", id)
    .eq("active", true)
    .order("state", { ascending: true })
    .limit(20);

  // 3. Policy alert this article spawned, if any.
  let triggeredAlert: {
    id: string; severity: string; title: string; locality: string | null;
  } | null = null;
  if (article.policy_alert_id) {
    const { data } = await sb
      .from("policy_alerts")
      .select("id, severity, title, locality")
      .eq("id", article.policy_alert_id)
      .maybeSingle();
    triggeredAlert = data ?? null;
  }

  const bill = Array.isArray(article.bills) ? article.bills[0] : article.bills;
  const publishedAt = article.published_at ? new Date(article.published_at) : null;
  const scrapedAt = article.scraped_at ? new Date(article.scraped_at) : null;
  const gapDays = publishedAt && scrapedAt
    ? Math.floor((scrapedAt.getTime() - publishedAt.getTime()) / 86_400_000)
    : 0;
  const externalUrl = article.resolved_url ?? article.url;

  // Media split for in-app rendering. Videos embed via the publisher's
  // own player URL (CSP frame-src already allows youtube-nocookie +
  // vimeo); images load from their CDN (img-src https: allowed).
  const media = Array.isArray(article.media_urls) ? article.media_urls : [];
  const videos = media.filter((m) => (m.type === "youtube" || m.type === "vimeo") && m.embed_url);
  const images = media.filter((m) => m.type === "image" && m.url);
  const leadImage = images.find((m) => m.lead) ?? images[0] ?? null;
  const galleryImages = images.filter((m) => m !== leadImage).slice(0, 4);
  const paragraphs = Array.isArray(article.body_paragraphs) ? article.body_paragraphs : [];

  const TOPIC_COLORS: Record<string, string> = {
    legislation: "bg-emerald-950/40 text-emerald-300",
    science: "bg-blue-950/40 text-blue-300",
    business: "bg-amber-950/40 text-amber-300",
    enforcement: "bg-red-950/40 text-red-300",
    culture: "bg-purple-950/40 text-purple-300",
  };

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <nav className="mb-4 text-xs text-zinc-500">
        <Link href="/news" className="hover:text-emerald-300">← All news</Link>
        {article.state && (
          <>
            {" · "}
            <Link href={`/news?state=${article.state}`} className="hover:text-emerald-300">{article.state}</Link>
          </>
        )}
        {article.kratom_topic && (
          <>
            {" · "}
            <span className="capitalize">{article.kratom_topic}</span>
          </>
        )}
      </nav>

      <header className="mb-6 border-b border-zinc-800 pb-5">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          {article.state ? (
            <span className="rounded bg-zinc-900 px-2 py-0.5 font-mono text-zinc-300">{article.state}</span>
          ) : (
            <span className="rounded bg-purple-950/40 px-2 py-0.5 text-purple-300">Federal</span>
          )}
          {article.kratom_topic && (
            <span className={`rounded px-2 py-0.5 capitalize ${TOPIC_COLORS[article.kratom_topic] ?? "bg-zinc-900 text-zinc-400"}`}>
              {article.kratom_topic}
            </span>
          )}
          {article.ai_relevance_score != null && article.ai_relevance_score >= 0.7 && (
            <span className="text-zinc-500">{Math.round(article.ai_relevance_score * 100)}% match</span>
          )}
        </div>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{article.title}</h1>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
          {article.source_name && (
            <span className="text-zinc-400">
              <span className="text-zinc-500">Source:</span> <strong className="text-zinc-200">{article.source_name}</strong>
            </span>
          )}
          {publishedAt && (
            <span className="text-emerald-300" title={publishedAt.toISOString()}>
              📰 Published {publishedAt.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}
            </span>
          )}
          {scrapedAt && (
            <span className={gapDays > 7 ? "text-amber-400" : "text-blue-400"} title={`Indexed ${gapDays}d after publication`}>
              🛰 Indexed {scrapedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
      </header>

      {article.summary && (
        <section className="mb-6 rounded-lg border border-emerald-700/30 bg-gradient-to-br from-emerald-950/20 to-zinc-950/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            🧠 iKratom summary
          </p>
          <p className="text-sm leading-relaxed text-zinc-200">{article.summary}</p>
        </section>
      )}

      {/* Lead image */}
      {leadImage && (
        <figure className="mb-6 overflow-hidden rounded-lg border border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={leadImage.url}
            alt={article.title}
            className="w-full object-cover"
            loading="lazy"
          />
          {article.source_name && (
            <figcaption className="bg-zinc-950/60 px-3 py-1 text-[10px] text-zinc-500">
              Image: {article.source_name}
            </figcaption>
          )}
        </figure>
      )}

      {/* Embedded video(s) — watch in-app */}
      {videos.length > 0 && (
        <section className="mb-6 space-y-4">
          {videos.map((v) => (
            <div key={v.embed_url} className="overflow-hidden rounded-lg border border-zinc-800">
              <div className="relative aspect-video">
                <iframe
                  src={v.embed_url}
                  title="Embedded video"
                  className="absolute inset-0 h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                  loading="lazy"
                />
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Fair-use lead excerpt — paragraphs preferred, fallback to the
          short kratom-verification excerpt. Plain text only (rendered as
          React <p> — no publisher HTML), capped, with link-out below. */}
      {paragraphs.length > 0 ? (
        <section className="mb-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            From the article
          </p>
          <div className="space-y-3 text-[15px] leading-relaxed text-zinc-200">
            {paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      ) : article.body_extract_excerpt ? (
        <section className="mb-6">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Excerpt from the article
          </p>
          <blockquote className="border-l-2 border-zinc-700 pl-4 text-sm leading-relaxed text-zinc-300">
            {article.body_extract_excerpt}
          </blockquote>
        </section>
      ) : null}

      {/* Image gallery (non-lead) */}
      {galleryImages.length > 0 && (
        <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {galleryImages.map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.url}
              src={img.url}
              alt=""
              className="h-32 w-full rounded border border-zinc-800 object-cover"
              loading="lazy"
            />
          ))}
        </section>
      )}

      <section className="mb-8 rounded-md border border-zinc-800 bg-zinc-950/60 p-4">
        <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-500">
          Continue reading at the original source
        </p>
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md border border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-500"
        >
          {article.source_name ? `Read at ${article.source_name}` : "Read the full article"} ↗
        </a>
        <p className="mt-2 text-[10px] text-zinc-500">
          Articles are not republished in full to respect publisher copyright. We surface our AI summary + a short excerpt, then link out.
        </p>
      </section>

      {bill && (
        <section className="mb-6">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-400">
            🔗 Linked legislation
          </p>
          <Link
            href={`/bills/${bill.id}`}
            className="block rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 transition hover:border-emerald-500"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono font-semibold text-zinc-100">{bill.state} {bill.bill_number}</span>
              {bill.kratom_relevance === "anti" && (
                <span className="rounded bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300">Anti</span>
              )}
              {bill.kratom_relevance === "pro" && (
                <span className="rounded bg-emerald-950/40 px-1.5 py-0.5 text-[10px] text-emerald-300">Pro</span>
              )}
              {bill.status && <span className="text-[10px] text-zinc-500">[{bill.status}]</span>}
              {bill.last_action_at && (
                <span className="ml-auto text-[10px] text-zinc-500">{bill.last_action_at}</span>
              )}
            </div>
            {bill.title && <p className="mt-1 text-[13px] text-zinc-300">{bill.title}</p>}
            {bill.last_action && <p className="mt-1 text-[11px] text-zinc-500">{bill.last_action}</p>}
          </Link>
        </section>
      )}

      {triggeredAlert && (
        <section className="mb-6">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-400">
            {triggeredAlert.severity === "critical" ? "🚨" : "⚠️"} Triggered alert
          </p>
          <Link
            href={`/alerts/${triggeredAlert.id}`}
            className={`block rounded-lg border p-4 transition hover:border-emerald-500 ${
              triggeredAlert.severity === "critical"
                ? "border-red-700/40 bg-red-950/10"
                : "border-amber-700/30 bg-amber-950/10"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              {triggeredAlert.locality && (
                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-300">
                  {triggeredAlert.locality}
                </span>
              )}
              <span className="text-[13px] font-semibold text-zinc-100">{triggeredAlert.title}</span>
            </div>
          </Link>
        </section>
      )}

      {siblings && siblings.length > 0 && (
        <section className="mb-6">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-zinc-400">
            Also reported in
          </p>
          <ul className="flex flex-wrap gap-2 text-[11px]">
            {siblings.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/news/${s.id}`}
                  className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-zinc-300 hover:border-emerald-500"
                >
                  <span className="font-mono text-[10px] text-zinc-400">{s.state ?? "FED"}</span>
                  <span>{s.source_name ?? "source"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <Link href="/news" className="text-xs text-zinc-500 hover:text-emerald-300">
          ← Back to all news
        </Link>
        <Link href={`/news?state=${article.state ?? "all"}`} className="text-xs text-zinc-500 hover:text-emerald-300">
          More {article.state ?? "federal"} news →
        </Link>
      </footer>
    </article>
  );
}
