import type { MetadataRoute } from "next";

/**
 * robots.txt — allow ordinary search engines, block declared AI training
 * crawlers. Honor-system; combined with TOS + auth-required pages + rate
 * limits + CSP for stuff that matters.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "https://www.ikratom.org";
  return {
    rules: [
      // Normal search engines. /pitch is intentionally unlisted (investor/
      // dev-friend share link) — explicit Disallow in addition to the page's
      // own `robots: { index: false }` metatag gives a second layer for
      // well-behaved crawlers that obtain the URL via a forwarded share.
      { userAgent: "*", allow: "/", disallow: ["/admin/", "/api/", "/account/", "/messages/", "/dashboard/", "/pitch"] },

      // Block declared AI training crawlers explicitly
      ...[
        "GPTBot",
        "ChatGPT-User",
        "OAI-SearchBot",
        "ClaudeBot",
        "Claude-Web",
        "anthropic-ai",
        "CCBot",
        "Google-Extended",
        "PerplexityBot",
        "YouBot",
        "Amazonbot",
        "Bytespider",
        "FacebookBot",
        "Meta-ExternalAgent",
        "Meta-ExternalFetcher",
        "Diffbot",
        "ImagesiftBot",
        "DataForSeoBot",
        "Applebot-Extended",
        "cohere-ai",
        "ai2bot",
        "Timpibot",
      ].map((bot) => ({ userAgent: bot, disallow: "/" })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
