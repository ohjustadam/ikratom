# Runbook: moving hosts

_Written 2026-11-25 (owner: "prepare for the evolution, make it easy when we do move hosts")._ The aim is a site that runs on free tiers for good. Today it runs on Netlify's **Personal** plan ($9, 1,000 credits a month; read it from the API, never from memory). Its idle burn is about 14 credits a day, so a free 300-credit plan cannot hold it. The candidates and their open questions are in the owner's hosting note in `private/` (Cloudflare Workers Paid with CPU-time billing, still to be proven under workerd; an Oracle Always Free VM as a standby origin). This page makes whichever one wins a short, reversible job.

## What does NOT move

These belong to the domain or to their own service, not to the host:

- **DNS and the Cloudflare zone**: custom rules, the rate-limit rule, Bot Fight Mode, cache rules, Turnstile. The rule list is operational detail and lives in `private/`.
- **Supabase** (database, Auth, the Site URL `https://www.ikratom.org`), **R2 snapshots**, **email** (Cloudflare Email Routing, Resend, Brevo).
- **GitHub Actions crons** and every secret in them.
- **Search Console** (a Domain property on `ikratom.org`) and the sitemap already submitted there.
- **The canonical host `www.ikratom.org`.** Every shared link, search result and `security.txt` rides on it. A move changes what sits behind it, never the name.

## What is host-coupled (the whole list)

| Piece | Where | On a move |
|---|---|---|
| Build and adapter | `netlify.toml`, `@netlify/plugin-nextjs` | New host's build. The `ignore` rule exists only because builds cost credits; drop it where they do not. `src/proxy.disabled.ts` is off because Netlify's adapter could not bundle it; leave it off. |
| Cron origin | `netlify.toml` (`ikratom.netlify.app/api/cron/*` passthrough, everything else 308 to www), `CRON_ORIGIN` | Cloudflare challenges GitHub runners, so crons reach the host directly. The new host must serve `/api/cron/*` on a direct URL (every route already needs `CRON_SECRET`). Set `CRON_ORIGIN` to it. |
| Usage meter | `scripts/lib/usage-meter.mjs` (the crawl brake and `crawl-stage.mjs` read it), `scripts/lib/netlify-credits.mjs`, `scripts/netlify-credit-gate.mjs` (CI), `scripts/limits-console.mjs` | Add one adapter to `usage-meter.mjs`, set `HOST_METER`. Until then the brake reads BLIND, which refuses a lift and pages on the third run; it never reads "all clear". Retire or replace the CI credit gate. |
| Secrets sync | `scripts/netlify-env-sync.mjs`, `.env.local.example` (the variable list) | Import the same variables into the new host. |
| Deploy checks | `.github/workflows/draft-preview.yml`, `cloudflare-purge-after-deploy.yml`, `scripts/smoke-check.mjs` | Repoint at the new host's deploy event and URL. `smoke-check.mjs --url` already takes any URL. |
| Deploy firing | the trunk's production build through Netlify's builds API (AGENTS.md rule 7) | The new host's deploy hook. Rule 7's credit-batching rationale goes away on a host that does not bill per build. |
| Names in public pages | `siteConfig.infra` in `src/config/site.config.ts` (read by the privacy page) | Edit two words. Nothing else on a public page names a host. |
| Page caching | Cloudflare cache rules plus the adapter's ISR and `unstable_cache` | Behaviour differs per adapter. After the move, check `x-nextjs-cache` on the pages the cache rules list. |

The application code is close to host-neutral: `src/` only mentions Netlify in comments.

## Moving, with an instant way back

1. **Build on the new host** from the commit that is live, with every environment variable set. Do not touch DNS yet.
2. **Measure it cold** on its direct URL: `node --env-file=.env.local scripts/crawl-lift-check.mjs --stage 3 --origin <direct URL>`, then `node scripts/smoke-check.mjs --url <direct URL>`.
3. **Point the crons at it**: set `CRON_ORIGIN` to the direct URL and run one cron by hand from `/admin/console`.
4. **Teach the brake**: write the `usage-meter.mjs` adapter and set `HOST_METER` in GitHub Actions and `.env.local`. Add its test beside `tests/usage-meter.test.ts`.
5. **Cut over** in Cloudflare by changing where the proxied `www` record points. The proxy stays, so every rule keeps working. Keep SSL on **Full (strict)**: the new origin must present a valid certificate for `www.ikratom.org` (the host's own, or a Cloudflare Origin CA certificate). Do not drop to Flexible to make it work.
6. **Watch for an hour**: `smoke-check.mjs` against www, a sign-up, a one-click send, a push, `flood_alarm`, the `crawl_brake` rows in `scraper_runs`, and the next cron runs.
7. **Way back**: point the record at the old host. Leave the old deploy standing for 7 days, and keep an eye on what it costs while it idles.
8. **Afterwards**: delete the old project and its tokens, and update this page, `STATE_OF_PLAY.md`, `docs/RUNBOOK_crawl_lift.md` and AGENTS.md rule 7.

## Ceilings that follow us to any host

| Service | Free-tier edge | State |
|---|---|---|
| Cloudflare custom rules | 5 per zone (a rule is a condition plus an action, so rules with the same action merge into one). **Keep one slot empty** for the next flood. | 4 of 5 used 2026-11-25 |
| Cloudflare rate limiting | 1 rule | 1 of 1 |
| Cloudflare Workers Free | 100,000 requests a day | not in use |
| Supabase | 500 MB database, 5 GB egress | 366 of 500 MB on 2026-11-18 |
| Netlify | 1,000 credits on Personal | about 77% on 2026-11-25 |

## Standing renewals

- `public/.well-known/security.txt` **Expires 2027-11-24.** Renew it before then (it is a one-line edit and a `[skip netlify]` merge).
