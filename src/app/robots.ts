import type { MetadataRoute } from "next";

/**
 * robots.txt — allow ordinary search engines + AI CITATION crawlers,
 * block AI TRAINING crawlers.
 *
 * Distinction matters: this platform's value compounds when AI
 * assistants cite our pages with correct attribution to advocates +
 * legislators + bills. When a user asks ChatGPT 'what's TN HB 1649?',
 * we want OpenAI's SEARCH crawler (not training crawler) to fetch our
 * page so the answer includes our structured data (see JSON-LD in
 * /alerts/[id], /bills/[id], /research/[id], /meetings/[id], /states/[code]).
 *
 * Training crawlers (GPTBot, anthropic-ai, CCBot, etc.) consume content
 * to train future model weights with no per-query attribution back.
 * Those stay blocked.
 *
 * Citation crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot,
 * Claude-Web, etc.) fetch at query-time to answer with citations.
 * Those are now allowed.
 *
 * Honor-system; combined with TOS + auth-required pages + rate limits
 * + CSP for stuff that matters.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "https://www.ikratom.org";

  // Private surfaces — never index regardless of crawler
  const PRIVATE_PATHS = ["/admin/", "/api/", "/account/", "/messages/", "/dashboard/", "/pitch"];

  // ALLOW: AI search/citation crawlers — query-time fetchers that
  // attribute back to the source URL. Sending them to our structured
  // data is the whole point.
  const ALLOW_AI_CITATION_BOTS = [
    "OAI-SearchBot",       // OpenAI's search-time crawler (ChatGPT cite-with-link mode)
    "ChatGPT-User",        // ChatGPT browsing on user's behalf (cites source)
    "Claude-Web",          // Claude.ai web search (cites source)
    "PerplexityBot",       // Perplexity (always cites)
    "YouBot",              // You.com search
    "Applebot",            // Apple Spotlight + Siri search
    "DuckAssistBot",       // DuckDuckGo AI assistant
  ];

  // BLOCK: AI TRAINING crawlers — pull content to train future model
  // weights without per-query attribution. Our content is collaborative
  // intel; we want it cited, not commoditized into model weights.
  const BLOCK_AI_TRAINING_BOTS = [
    "GPTBot",              // OpenAI training crawler
    "ClaudeBot",           // Anthropic training crawler
    "anthropic-ai",        // Anthropic training crawler (legacy UA)
    "CCBot",               // Common Crawl (feeds most LLM training datasets)
    "Google-Extended",     // Google's Gemini / Bard training opt-out
    "Applebot-Extended",   // Apple Intelligence training opt-out
    "Meta-ExternalAgent",  // Meta training crawler
    "Meta-ExternalFetcher",
    "Bytespider",          // ByteDance / Doubao training
    "Diffbot",             // commercial data extraction
    "ImagesiftBot",        // image scraping
    "DataForSeoBot",       // SEO data resale
    "cohere-ai",           // Cohere training
    "ai2bot",              // AI2 training
    "Timpibot",            // Timpi training
    "FacebookBot",         // Facebook's separate training crawler (UA differs from OG fetcher)
    "Amazonbot",           // Amazon training / Alexa
  ];

  return {
    rules: [
      // Default: ordinary search engines allowed everywhere except private paths
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },

      // Explicit allow for citation crawlers — same scope as default
      ...ALLOW_AI_CITATION_BOTS.map((bot) => ({
        userAgent: bot,
        allow: "/",
        disallow: PRIVATE_PATHS,
      })),

      // Explicit block for training crawlers
      ...BLOCK_AI_TRAINING_BOTS.map((bot) => ({ userAgent: bot, disallow: "/" })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
