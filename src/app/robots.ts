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

  // Cost-control disallow, added 2026-09-01. NOT a privacy or quality call.
  //
  // Every crawl of a legislator DETAIL page is a full server render — uncached
  // DB read-set, billed Netlify request, billed compute, billed bandwidth.
  // There are 1,001 of them and measured traffic was 99.97% bots (Supabase
  // edge logs: 19,833 server-side reads/day from Netlify vs 11 from consumer
  // ISPs). That burned 3.9 credits/day with ZERO deploys and put the 300-credit
  // cap at ~2026-09-09, ten days before the 09-19 reset. Netlify disables the
  // whole site at the cap; that is what happened on 2026-07-30.
  //
  // Note the trailing slash: this blocks /legislators/<id> but NOT the
  // /legislators index, which stays indexed along with bills, campaigns,
  // briefings and states. The pages remain fully reachable in-app and by
  // direct link — we are only declining to invite a 1,001-page sweep.
  //
  // REVISIT after the credit reset: once these routes are CDN-cacheable (needs
  // the signedIn signup-wall moved client-side, the /api/me pattern the root
  // layout already uses) a crawl costs almost nothing and this should be lifted.
  //
  // ⚠ TEMPORARY — REMOVE AFTER THE 2026-09-19 CREDIT RESET. ⚠
  // /bills/ is here reluctantly. Bill detail pages are the platform's most
  // valuable indexed content ("what is TN HB 1649?") and giving that up hurts
  // the mission. But the arithmetic left no room: after a 15-credit deploy the
  // budget allows 0.87 credits/day for 17 days and the measured idle burn was
  // 3.9/day, so a ~78% cut was required and legislators alone (70% of URLs)
  // was not enough — bills are advertised changeFrequency:daily/priority:0.8
  // against legislators' monthly/0.4, so they are crawled harder per URL.
  // Being disabled is a 100% outage, which is strictly worse than being
  // temporarily less discoverable.
  // Restoring /bills/ is a one-line delete here; do it in the first deploy
  // after the reset, ideally together with CDN-caching these routes.
  const COST_CONTROL_PATHS = ["/legislators/", "/bills/"];
  const DISALLOW = [...PRIVATE_PATHS, ...COST_CONTROL_PATHS];

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

  // BLOCK: commercial SEO / backlink / market-intel crawlers. These are
  // reputable (they DO honor robots.txt) but crawl aggressively and give a
  // nonprofit advocacy site ZERO value — no search referrals, no citations,
  // just repeated hits against uncached dynamic pages that each run DB reads.
  // Added 2026-07-16 as part of the egress-survival diet: with ~10 MAU the
  // free-tier 5GB/mo Supabase egress cap was blown by bot + cron reads, and
  // these SEO crawlers are pure DB-egress cost. Complements the read-caching
  // work; robots.txt is honor-system, so it only stops the compliant ones,
  // but the compliant ones are exactly the heavy-yet-useless SEO fleet.
  const BLOCK_SEO_SCRAPER_BOTS = [
    "AhrefsBot",           // Ahrefs backlink index — very aggressive
    "SemrushBot",          // Semrush SEO audit crawler
    "MJ12bot",             // Majestic backlink crawler
    "DotBot",              // Moz / OpenSiteExplorer
    "rogerbot",            // Moz (legacy UA)
    "BLEXBot",             // WebMeUp backlink crawler
    "PetalBot",            // Huawei Petal search — heavy, low referral value
    "MegaIndex.ru",        // MegaIndex SEO
    "SeekportBot",         // Seekport
    "serpstatbot",         // Serpstat SEO
    "Barkrowler",          // Babbar.tech backlink crawler
    "ZoominfoBot",         // ZoomInfo B2B data resale
    "magpie-crawler",      // Brandwatch
    "DataForSeoBot",       // SEO data resale (also listed above for AI; explicit here)
  ];

  return {
    rules: [
      // Default: ordinary search engines allowed everywhere except private paths.
      //
      // crawlDelay added 2026-08-30. The sitemap advertises ~1,430 URLs and 94%
      // of them are /legislators/[id] (1,001) and /bills/[id] (341). Every sweep
      // of that surface is billed TWICE on Netlify's credit-free tier — once as
      // web requests, once as compute — and those are the two meters the API
      // does not expose, so they burned ~57% of the month's credits invisibly.
      // Caching those routes is the real fix (same commit); this just stops a
      // single crawler from sweeping the whole surface in one burst.
      // Google ignores crawlDelay (use Search Console), but Bing, Yandex and
      // most of the long tail honour it.
      { userAgent: "*", allow: "/", disallow: DISALLOW, crawlDelay: 10 },

      // Explicit allow for citation crawlers — same scope as default.
      // These stay ALLOWED on purpose: when someone asks an assistant "what is
      // TN HB 1649?", we want our page cited with attribution. That is the
      // mission. They get the same crawlDelay, not a block.
      ...ALLOW_AI_CITATION_BOTS.map((bot) => ({
        userAgent: bot,
        allow: "/",
        disallow: DISALLOW,
        crawlDelay: 10,
      })),

      // Explicit block for training crawlers
      ...BLOCK_AI_TRAINING_BOTS.map((bot) => ({ userAgent: bot, disallow: "/" })),

      // Explicit block for aggressive SEO / market-intel crawlers (egress diet)
      ...BLOCK_SEO_SCRAPER_BOTS.map((bot) => ({ userAgent: bot, disallow: "/" })),
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
