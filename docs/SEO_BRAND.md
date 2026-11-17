# Why Googling "ikratom" shows kratom, and what fixes it

Checked 2026-11-17 by session 7ef4f0. Code fixes in the PR titled `fix(seo): …brand identity` (see git log).

## The short answer

Google **has** indexed ikratom.org and **does** rank it first for our name. It
just doesn't believe "ikratom" is a name yet. It treats the word as a typo of
"kratom" and quietly swaps the query.

| Search (google.com, en-US, signed out) | What Google did |
|---|---|
| `ikratom` | Banner "These are results for **kratom** · Search instead for ikratom". Page 1 is Mayo Clinic, DEA, FDA, NIDA, 60 Minutes. No ikratom.org. |
| `ikratom` with Verbatim on (Tools → All results → Verbatim) | "Did you mean: kratom", then **ikratom.org #1 with five sitelinks** (Welcome, Library, Knowledge, Advocacy, Call your reps). |
| `ikratom.org` | ikratom.org #1 with sitelinks (Action, Legislative, Intel, Knowledge) and an AI Overview that describes us correctly. |
| `site:ikratom.org` | Our pages are listed (home, pulse, videos, support, privacy, intel, briefings, deadlines, coalitions, …), with a "Try Google Search Console: do you own ikratom.org?" promo, which means **Search Console has never been set up**. |

So indexing works and relevance works. What's missing is the evidence Google
uses to stop "correcting" a brand: people searching the exact word and
choosing us, other sites naming "iKratom" and linking to us, and our own pages
stating the name in structured data. Other "iKratom" names compete for the
word too: a Twitch streamer, an Instagram vendor account and a vendor's
product tag all appear in the verbatim results.

## What was checked, and the result

| Check | Result | Evidence |
|---|---|---|
| Indexing | OK | `site:ikratom.org` lists our pages on Google, Bing, Mojeek and Startpage. |
| Googlebot access | OK | Google's Rich Results Test fetched `https://www.ikratom.org/` as Googlebot: "Crawled successfully". No Cloudflare rule challenges verified search crawlers. |
| robots.txt | OK for the brand | `/` and every hub page are allowed. The detail-page disallows are deliberate cost control (`src/lib/crawl-policy.ts`, self-expiring 2027-01-16) and don't touch the home page. |
| sitemap.xml | OK | 99 URLs: the hubs, 52 state pages, install pages. Listed in robots.txt. |
| www vs apex | OK | `http://ikratom.org` → `https://ikratom.org` → `https://www.ikratom.org` (301s). `http://www` → `https://www` (301). |
| noindex by accident | None | Every public page sends `index, follow`. |
| Canonical tags | **Missing everywhere** | No page had `<link rel="canonical">`. Invite links (`/?via=CODE`), `?ref=` and `?utm_` variants were all separate URLs to Google. |
| Organization / WebSite JSON-LD | **Missing** | The home page had no structured data. Rich Results Test: "No items detected". |
| Home `<title>` | Weak | Just "iKratom". |
| Titles | **Brand doubled** on 24 pages | e.g. "All 50 states · iKratom \| iKratom", because pages hand-added the brand the layout template already appends. |
| Private pages in the index | Yes | Google lists `/login` and `/account` ("Account \| iKratom"); internal `/search` results were indexable. |
| `/favicon.ico` | 404 | Browsers and Bing still ask for it. Left to the "ik" mark change, which builds the whole icon set. |
| GitHub repo website field | **Points at the paused Vercel spare** | `ikratom.vercel.app` (HTTP 402). Our best existing backlink goes nowhere. |

## Fixed in code (ships in the next production build)

- **WebSite + Organization JSON-LD** on the home page (`src/lib/seo.ts`):
  name "iKratom", alternate names "ikratom" and "iKratom.org", logo, slogan,
  support address, and `sameAs` for official profiles (`siteConfig.sameAs`;
  add each new official profile there).
- **Home title** "iKratom: the kratom advocate's toolbelt", plus a canonical.
- **Canonical tags** on the home page, all 47 hub pages in the sitemap, and
  every state page (`/states/OK` style, matching the sitemap).
- **noindex, follow** on sign-in, MFA, account, dashboard, inbox,
  notifications, password reset, onboarding, the suspended-account page and
  internal search results.
- **Doubled brand** removed from 24 titles; a test fails if one comes back
  (`src/lib/__tests__/seo.test.ts`).
- README now links the live site.

## What only the owner can do

These need the owner's own Google, Microsoft, Cloudflare or GitHub login. None
of them needs a deploy.

### 1. Google Search Console (15 minutes, the most important step)

1. Open https://search.google.com/search-console and sign in with the Google
   account that should own the site.
2. Click **Add property**. Choose the left box, **Domain**, type `ikratom.org`, click **Continue**.
3. Google shows a TXT record starting `google-site-verification=`. Click **Copy**.
4. In a new tab open https://dash.cloudflare.com → **ikratom.org** → **DNS** → **Records** → **Add record**.
5. Type **TXT**, Name `@`, Content: paste the value. TTL Auto. **Save**.
6. Back in Search Console click **Verify**. If it says not found, wait 10 minutes and click Verify again.
7. Left menu **Sitemaps** → "Add a new sitemap" → type `sitemap.xml` → **Submit**. Status should read "Success".
8. Left menu **URL inspection** → paste `https://www.ikratom.org/` → Enter → **Request indexing**.
9. After the next production build, run the same URL inspection again so Google picks up the new structured data.
10. Optional: **Settings** → **Users and permissions** → **Add user** to give a second account Full access.

### 2. Bing Webmaster Tools (5 minutes; Bing also feeds DuckDuckGo, Yahoo and ChatGPT search)

1. Open https://www.bing.com/webmasters and sign in (a Microsoft, Google or Facebook login works).
2. Choose **Import your sites from GSC** → **Continue** → allow access → tick ikratom.org → **Import**. Bing copies the verified site and the sitemap.
3. If import isn't offered: **Add site manually** → `https://www.ikratom.org` → choose **DNS (CNAME)** → add that CNAME in Cloudflare DNS exactly as shown → **Verify**.
4. **Sitemaps** → **Submit sitemap** → `https://www.ikratom.org/sitemap.xml`.

### 3. Cloudflare Crawler Hints (2 minutes, free)

Cloudflare tells Bing and Yandex through IndexNow whenever a page changes, so new bills and campaigns get crawled quickly. Bing then fetches only what changed, which is cheaper than a crawl.

1. https://dash.cloudflare.com → **ikratom.org** → **Caching** → **Configuration**.
2. Find **Crawler Hints** and switch it **On**.

### 4. GitHub repo website (1 minute)

1. https://github.com/ohjustadam/ikratom → the gear icon next to **About** (right column).
2. Website: replace `https://ikratom.vercel.app` with `https://www.ikratom.org` → **Save changes**.

### 5. Earn real links and mentions (ongoing, the slow but decisive part)

Google stops rewriting a brand when the web treats it as one. Every one of these should say **iKratom** and link to `https://www.ikratom.org`:

- **AKA and GKC.** Ask each for a listing on their resources or "tools for advocates" page. We're a free, nonpartisan tool that sends their members' letters, which is easy for them to say yes to.
- **Reddit.** r/kratom and the state subs, through the modmail proposal already drafted: a pinned "find your legislator / track your bill" resource link. Post bill alerts with the link when a bill moves.
- **A Facebook page** named exactly "iKratom", with the website field filled in. Add its URL to `siteConfig.sameAs` in `src/config/site.config.ts`. Do the same for any Bluesky, X, YouTube or TikTok account.
- **Local news.** Oklahoma outlets first, where the owner co-wrote the KCPA: offer a short quote or data on a bill they're already covering ("iKratom, a free advocacy tracker, counts N kratom bills this session"). Reporters link the source.
- **Partner shops.** The QR kit already prints the link. A "Find your legislator at ikratom.org" line on shop sites and receipts counts too.
- **Every profile the owner already has** (LinkedIn, X, personal site): put iKratom and the link in the bio.

### 6. Weekly brand check (5 minutes, Mondays)

1. Open a private/incognito window, go to google.com, search `ikratom`.
2. Note one of three states:
   - **Rewritten:** "These are results for kratom". This is where we are on 2026-11-17.
   - **Suggested:** "Did you mean: kratom" but ikratom.org on page 1.
   - **Won:** ikratom.org first, no correction.
3. Click **Search instead for ikratom** and check that ikratom.org is first.
4. In Search Console: **Performance** → **+ New** → **Query** → "Queries containing" `ikratom` → **Apply**. Note impressions, clicks and average position. Rising impressions on the exact query come before Google stops rewriting it.

## Notes for sessions

- Structured data uses `siteConfig.url`, never an env value, so a draft deploy can't announce a different site.
- The Organization logo is `/ikratom-icon-512.png`. Keep that path when the mark changes: Google caches logos by URL.
- Don't add `alternates` to the root layout. Child pages inherit it, so every page would claim to be the home page.
- A page with its own `openGraph` replaces the layout's whole `openGraph` object. Set `siteName` again if you add one.
