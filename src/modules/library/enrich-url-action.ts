"use server";

import { getCreatorContext } from "@/modules/admin/actions";
import { complete } from "@/lib/ai";
import { safeFetch } from "@/lib/url-safety";

/**
 * Enrich a library item from a URL — single-button "fetch metadata"
 * that powers the streamlined add-to-library flow.
 *
 * Pipeline:
 *   1. Detect URL type (YouTube vs generic article vs podcast platform)
 *   2. For YouTube: hit oEmbed (no auth) → title, author, thumbnail
 *      Then AI-summarize from title + author for the description
 *   3. For generic web: server-side fetch + parse Open Graph + Twitter
 *      card meta tags. AI-summarize description if og:description short.
 *   4. For PubMed / NCBI: future — fetch via NCBI E-utilities
 *
 * Returns suggested values for the library form. User reviews + edits
 * before saving. Never persists directly — admin still confirms.
 */

export type LibraryUrlSuggestion = {
  type: "video" | "audio" | "article" | "book" | "document";
  title: string;
  description: string;
  url: string;
  embed_html?: string;
  cover_image_url?: string;
  author?: string;
  source_org?: string;
  published_at?: string; // YYYY-MM-DD
  duration_seconds?: number;
  // Quality + source tracking — UI surfaces what we got vs guessed
  source_type: "youtube_oembed" | "open_graph" | "ai_inferred" | "unknown";
  warnings: string[];
};

type EnrichResult =
  | { ok: true; suggestion: LibraryUrlSuggestion }
  | { ok: false; error: string };

export async function enrichLibraryUrl(rawUrl: string): Promise<EnrichResult> {
  const ctx = await getCreatorContext();
  if (!ctx.ok) return { ok: false, error: "Admin or advocate-leader only." };

  const url = rawUrl.trim();
  if (!url) return { ok: false, error: "URL is required." };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must be http or https." };
  }

  const host = parsed.hostname.replace(/^www\./, "");

  // ── YouTube ────────────────────────────────────────────────────
  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
    return enrichYouTube(url);
  }

  // ── Generic web (article / podcast / other) ────────────────────
  return enrichGenericWeb(url);
}

// ── YouTube via oEmbed ────────────────────────────────────────────
// Free, no auth required. Returns title, author_name, thumbnail_url,
// embed html. Description not included — we AI-generate from title.
async function enrichYouTube(url: string): Promise<EnrichResult> {
  let oembed: {
    title?: string;
    author_name?: string;
    author_url?: string;
    thumbnail_url?: string;
    html?: string;
  };
  try {
    const oembedUrl = new URL("https://www.youtube.com/oembed");
    oembedUrl.searchParams.set("url", url);
    oembedUrl.searchParams.set("format", "json");
    const r = await fetch(oembedUrl.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "ikratom-library-enrich/1.0" },
    });
    if (!r.ok) {
      return {
        ok: false,
        error: `YouTube oEmbed returned ${r.status}. Check the URL or paste metadata manually.`,
      };
    }
    oembed = await r.json();
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't reach YouTube oEmbed: ${(e as Error).message?.slice(0, 100)}`,
    };
  }

  const title = oembed.title ?? "";
  const author = oembed.author_name ?? "";

  // AI-generate a short description from title + author. Best-effort —
  // if AI fails, leave description blank and warn the admin.
  let description = "";
  const warnings: string[] = [];
  try {
    const res = await complete(
      "general",
      [
        {
          role: "system",
          content:
            "You write neutral 1-2-sentence descriptions for a kratom-advocacy library catalog. Given a YouTube video's title and channel, produce a factual description suitable for a card teaser. Do NOT speculate about content you can't infer from the title. Do NOT use marketing language. If the title alone gives no clear topic, return exactly the title.",
        },
        {
          role: "user",
          content: `Title: ${title}\nChannel: ${author}\n\nWrite a 1-2 sentence library-card description.`,
        },
      ],
      {},
      { maxTokens: 300, temperature: 0.3 },
    );
    description = (res.text ?? "").trim();
  } catch {
    warnings.push("AI description generation failed — fill in manually.");
  }

  return {
    ok: true,
    suggestion: {
      type: "video",
      title,
      description,
      url,
      author,
      source_org: author, // YouTube channel = source org by default
      cover_image_url: oembed.thumbnail_url,
      embed_html: oembed.html,
      source_type: "youtube_oembed",
      warnings,
    },
  };
}

// ── Generic web via Open Graph + Twitter card ─────────────────────
async function enrichGenericWeb(url: string): Promise<EnrichResult> {
  let html: string;
  try {
    // SSRF-safe: validates the URL + re-validates each redirect hop, blocking
    // internal/metadata targets even via a public-URL → private-IP redirect.
    const f = await safeFetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: {
        // Pretending to be a normal browser — many sites block default
        // node fetch UA. Open Graph is meant for crawlers but real-
        // browser UA gives the broadest compatibility.
        "User-Agent":
          "Mozilla/5.0 (compatible; ikratom-library-enrich/1.0; +https://www.ikratom.org)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!f.ok) {
      return { ok: false, error: `Can't fetch that URL: ${f.reason}` };
    }
    const r = f.response;
    if (!r.ok) {
      return {
        ok: false,
        error: `Source returned ${r.status}. Some sites block automated fetches — paste fields manually if so.`,
      };
    }
    html = await r.text();
  } catch (e) {
    return {
      ok: false,
      error: `Couldn't fetch the URL: ${(e as Error).message?.slice(0, 100)}`,
    };
  }

  // Parse meta tags. Lightweight regex — no DOM library, no JS exec.
  // Only reads <meta property|name=... content=...> and <title>.
  const meta = parseMetaTags(html);
  const warnings: string[] = [];

  const title =
    meta["og:title"] ?? meta["twitter:title"] ?? meta["title"] ?? "";
  let description =
    meta["og:description"] ?? meta["twitter:description"] ?? meta["description"] ?? "";
  const cover =
    meta["og:image"] ?? meta["twitter:image"] ?? meta["twitter:image:src"];
  const author = meta["article:author"] ?? meta["author"] ?? "";
  const siteName = meta["og:site_name"] ?? "";
  const publishedRaw =
    meta["article:published_time"] ?? meta["datePublished"] ?? meta["date"];
  const published_at = normalizeDate(publishedRaw);

  // Type detection — most generic web URLs are articles. If the meta
  // type explicitly says video/audio we honor that.
  let type: LibraryUrlSuggestion["type"] = "article";
  if (meta["og:type"]?.startsWith("video")) type = "video";
  else if (meta["og:type"]?.startsWith("audio") || /(podcast|episode|listen)/i.test(url)) type = "audio";

  // If description is missing or too short to be useful, ask AI to
  // generate one from the title alone. Better than leaving blank.
  if (!description || description.length < 30) {
    if (title) {
      try {
        const res = await complete(
          "general",
          [
            {
              role: "system",
              content:
                "You write neutral 1-2-sentence descriptions for a kratom-advocacy library catalog. Given an article's title and source, produce a factual description suitable for a card teaser. Do NOT speculate beyond the title. Do NOT use marketing language. If the title alone gives no clear topic, return exactly the title.",
            },
            {
              role: "user",
              content: `Title: ${title}\nSource: ${siteName || new URL(url).hostname}\n\nWrite a 1-2 sentence library-card description.`,
            },
          ],
          {},
          { maxTokens: 300, temperature: 0.3 },
        );
        const aiDesc = (res.text ?? "").trim();
        if (aiDesc) {
          description = aiDesc;
          warnings.push("Description AI-inferred from title (source had no og:description).");
        }
      } catch {
        warnings.push("AI description generation failed — fill in manually.");
      }
    } else {
      warnings.push("Source had no Open Graph tags — most fields will be blank. Fill manually.");
    }
  }

  return {
    ok: true,
    suggestion: {
      type,
      title,
      description,
      url,
      author,
      source_org: siteName,
      cover_image_url: cover,
      published_at,
      source_type: title || description ? "open_graph" : "unknown",
      warnings,
    },
  };
}

// Lightweight meta-tag extractor. Doesn't pull in a parser — regex
// is fine for the well-formed meta tags Open Graph specifies.
function parseMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  // <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) out["title"] = decode(titleMatch[1]).trim();

  // <meta property|name=... content=...>
  const metaRe = /<meta[^>]+>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html))) {
    const tag = m[0];
    const propMatch =
      /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const contentMatch = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (propMatch && contentMatch) {
      const key = propMatch[1].toLowerCase();
      if (!(key in out)) out[key] = decode(contentMatch[1]).trim();
    }
  }
  return out;
}

// Minimal HTML entity decoder for the common cases that show up in
// meta tag content. Full decoder would require a library.
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x?([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, /[a-f]/i.test(n) ? 16 : 10)),
    );
}

function normalizeDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}
