# Runbook: lifting the crawl block, stage by stage

_Written 2026-11-24. Why: `robots.txt` has blocked sixteen families (bills, research, legislators and more) since 2026-09-01 to save Netlify credits, which also keeps them out of Google. KratomIndex (the research-index competitor) shows only for its own name in search, and we show for nothing, so the open ground is real. This is how to open it without repeating the September burn._

## What the switch is

`site_config.crawl_stage` (migration 0332), a number from 0 to 3. `robots.txt` and `sitemap.xml` read it hourly (`src/lib/crawl-stage.ts`), so changing it needs **no deploy**. Anything unreadable means 0. The default is 0, the old fully blocked list, so merging the code changes nothing until someone raises it.

| Stage | Opens | Why in this order |
|---|---|---|
| 0 | nothing (today) | |
| 1 | `/research/`, `/bills/` | Answer searches nobody owns ("what is TN HB 1649?"). Both read through R2 snapshots / `unstable_cache`. |
| 2 | + `/legislators/`, `/briefings/` | Cold render was 4 s, 1.0 s after #1149. About 1,000 near-identical pages: slower to earn index space. |
| 3 | + `/library/`, `/topics/` | Some sections render per viewer; check first. |

**Never opened by any stage** (`NEVER_LIFTED_PATHS`): `/forum /coalitions /profile /i /partners /meetings` (member content cannot be pulled back out of a search index; public anonymity), `/alerts /campaigns` (thousands of thin pages that expire), `/intel /academy` (per-viewer sections). Changing that list is a code edit with a reason.

## Before the first lift (all must be true)

1. **The 12-05 reset and the build with the signup fix are live.** A lift brings visitors, and visitors are the surge the signup path was not ready for (30 signup emails an hour, credits at the cap).
2. **Credits are calm.** `npm run credits` and the true meter: under 80% of the month, and the burn per day normal. `crawl-stage.mjs` refuses a raise at 80% or blind unless `--force`.
3. **Cold renders are cheap.** `node --env-file=.env.local scripts/crawl-lift-check.mjs --stage <n>` fetches 3 real URLs per family from the Netlify origin and says OK or HOLD (200, a title, under 2.5 s).
4. **Data is fit to be quoted.** Google and AI search will quote what is on these pages. Merge the bill twin pairs and settle the 20 inactive rows whose label does not fit their last action first, or leave those rows out.
5. **Search Console is verified** for `www.ikratom.org` (owner). Its Crawl stats page is the only live view of Googlebot's load, and it can request a slower crawl rate for 90 days.
6. **Decide what a Google visitor sees.** The crawl shield challenges every anonymous visit to `/bills/`, `/legislators/`, `/research` and `/intel/` (probed 2026-11-24: 403 `cf-mitigated: challenge`, even with a Google referer). A browser normally passes the challenge in a second or two, but it adds an interstitial to the first page a searcher sees. Real Googlebot is a verified bot and skips it. Options: leave it and measure bounce for a week, or exempt Google-referred visits on stage-1 families (a scraper can fake a referer). Decide before raising; do not discover it from the bounce rate.

## Where it stands (2026-11-25)

| Gate | State |
|---|---|
| 1. Reset and signup fix | The signup-queue build went live 18:42 UTC on 11-25. The 12-05 reset is still ahead. |
| 2. Credits calm | 768 of 1,000 (76.9%) on 11-25, about 14.5 a day, so roughly 908 by the reset. Under the 80% line today, but it will cross it before 12-05: raise after the reset. |
| 3. Cold renders | `crawl-lift-check.mjs --stage 3` against the published deploy's direct URL: **stages 1 and 2 pass** (/research 0.3-1.3 s, /bills 1.7-2.4 s, /legislators 1.2-1.8 s, /briefings 0.7-0.9 s). /bills is within a tenth of the 2.5 s limit. **Stage 3 is HOLD**: /topics/kratom took 3.3 s and /topics/cannabis 2.7 s. The check measures the direct deploy URL because the site's own netlify.app address answers 308 to www. |
| 4. Data fit | Owner and trunk: merge the bill twin pairs and settle the 20 inactive rows first. |
| 5. Search Console | Done. Domain property `ikratom.org` verified, `sitemap.xml` submitted 11-25 (it lists only the open pages), the home page, /pulse and /news are already indexed, no manual actions, no security issues. Crawl stats and the Pages report fill in over the next days. |
| 6. What a Google visitor sees | Leave the challenge. Real Googlebot is a verified bot and skips it; a person clicking a result gets a managed challenge that a normal browser clears in a second or two. Do **not** exempt by Referer: any scraper can send one. Measure bounce for the first week. |

## Lift

```bash
node --env-file=.env.local scripts/crawl-lift-check.mjs --stage 1
node --env-file=.env.local scripts/crawl-stage.mjs set 1 --yes
node scripts/session-mesh.mjs say --kind decision "crawl_stage raised to 1 (bills + research)" --as <id>
```

`robots.txt` and the sitemap update within the hour. The sitemap then lists up to 800 active bills and 1,000 papers (stage 2 adds up to 1,000 legislators), each with its own sync date as `lastmod`. Google takes weeks to index and rank, and will discover pages by links too.

**Hold each stage for 7 days** and watch: Search Console Crawl stats (requests per day, average response time), `npm run credits` per day, `flood_alarm`, and `crawl_brake` rows in `scraper_runs`. Then repeat for stage 2.

## The brakes

| Brake | Speed | How |
|---|---|---|
| `crawl_brake` job (hourly, `cron-hourly.yml`) | within the hour, then robots is cached by crawlers for up to a day | Lowers the stage to 0 and pages the owner when credits reach 90% or a day's passive burn is over 2.5x the median (and over 40 credits). It never raises. At stage 0 it only reads one row. |
| Manual | within the hour, then up to a day | `node --env-file=.env.local scripts/crawl-stage.mjs set 0 --yes` |
| Cloudflare lever | immediate | `node --env-file=.env.local private/scripts/cf-bot-brake.mjs --apply` challenges verified search crawlers (Googlebot, Bingbot, DuckDuckBot, Yandex, OAI-SearchBot, PerplexityBot) on the staged families. Link-preview bots are untouched. `--remove` undoes it. Googlebot treats a run of 403s as a request to slow down. |

Google ignores `Crawl-delay`; Bing honours it. Verified bots skip the Cloudflare shield and the per-IP rate limit (both say `not cf.client.bot`), which is exactly why the application-side brake exists.

## Failure modes already seen

- **2026-09-16:** the date lift fired and the caching half of the plan had never shipped; egress went to ~189 MB/day against a sustainable 167 within a day and a half.
- **Crawls hit each URL once**, so ISR and edge cache save nothing; only a cheaper render does (#1149).
- **`crawl_brake` blind** (Netlify endpoints moved, token expired): it pages on the third blind run in a row. Fix the reader in `scripts/lib/netlify-credits.mjs`.
- **A new column the app does not know yet** is harmless: `getCrawlStage()` fails closed to 0, and the brake records "no stage to brake".
