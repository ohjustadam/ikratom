# State of play

**The in-repo cold-start brief. Read this first.**

`AGENTS.md` tells you to start at `private/V2_KICKOFF.md`. That file is
gitignored, so it does not exist in a fresh clone — which means it does not
exist for any session running anywhere but the owner's own machine. Cloud
sessions have repeatedly had to re-derive the state of the platform from
scratch, and one of them re-derived it wrongly.

This file is the public half of that brief: everything a new session needs
that is safe to commit to a public repository. It carries no secrets, no
owner PII, and nothing about an unannounced plan. `private/V2_KICKOFF.md`
remains the owner's working notes and still wins on any conflict — but when
it is not there, this is the map.

It lives at the repository root on purpose. `netlify.toml`'s build `ignore`
rule skips a build for top-level markdown (`:(exclude,glob)*.md`, and git's
glob magic stops `*` at a `/`), so changing this file costs nothing. A file
under `docs/` would be free too; one under `src/` would not.

_Last hand-verified: 2026-09-18, against `main` at 740b139._
_For the live picture — which jobs ran, what is stale — run
`node --env-file=.env.local scripts/generate-state-of-play.mjs`._

---

## What this is

A nonpartisan civic-action platform for the kratom community. The product
rules in `CLAUDE.md` are hard constraints, not preferences: nonpartisan,
one-click, free-tier only, real synced data, public anonymity.

Scale, on this branch: 215 pages, 127 `CREATE TABLE` statements across 253
migrations, 194 scripts, 17 GitHub workflows, 104 monitored job sources.
(`scripts/generate-state-of-play.mjs --repo-only` reprints these from the tree,
so they cannot quietly rot.)

The `CLAUDE.md` "v1 scope" section describes a product that shipped long ago.
Do not read it as the current state — it is the original brief, kept for its
rules.

---

## Where it runs

| Thing | Reality | Common stale belief |
|---|---|---|
| Hosting | **Netlify**, `netlify.toml` | `ARCHITECTURE.md` and `AGENTS.md` still say Vercel |
| Cron | **GitHub Actions**, 17 workflows | `vercel.json` `crons` is `[]` and has been since 2026-07-26 |
| Request middleware | **Disabled** — `src/proxy.disabled.ts` | The docs describe an active `src/proxy.ts` |
| Bot blocking | **Cloudflare Bot Fight Mode** | The UA blocklist left with the proxy |
| Database | Supabase Postgres, RLS on every table | — |
| AI | Free providers only, via `scripts/lib/ai-router.mjs` | See `docs/AI_PROVIDERS.md` for which keys exist |

The proxy was renamed, not deleted, when the Netlify adapter could not bundle
Next 16 middleware. Security headers and CSP were unaffected — they are
enforced from `next.config.ts`. Two things it used to do have **not** been
restored:

- the account-lock / force-password-change redirect (data is still
  RLS-protected; this was the UX bounce to `/locked`)
- **embed / invite / landing-state cookie capture** — so referral
  attribution is currently not recorded at all. Partner QR codes, invite
  links and embeds credit nobody. Every growth number in `docs/VISION.md` is
  measured through a funnel that does not record its own input.

---

## What survives 60 days untouched

The standing goal is that the platform keeps working with nobody watching and
no dependency on the owner's PC being powered on. As of 2026-09-18 that is
almost true.

**Refreshes on its own:** the site itself, bills and votes and sponsors, the
news and alerts pipeline, campaign and wave delivery, the money and intel
scrapers, local officials and meetings, translations, portraits.

**Still needs the owner's PC** — `system: "local-box"` in
`scripts/lib/cron-pager-registry.mjs`:

- `session_prep` — writes a brief into the owner's own checkout. It has no
  user-facing effect, so its silence is not an outage. Arguably it should not
  be in the pager at all.
- `bill_embeddings` — bill-similarity clusters. A cloud path exists via
  `scripts/lib/embed-router.mjs` but the cutover is dispatch-only, pending a
  provider decision.

`topic_bill_discovery` **was** box-only on the stated grounds that LegiScan's
query API refuses GitHub Actions IPs. That note was stale: re-probed from a
runner on 2026-09-17, `getSearch` answered 3/3. It runs in CI now. Re-measure
with `scripts/diagnose-cloud-gaps.mjs` rather than trusting a comment — this
one cost weeks.

**The real 60-day risk is budget, not compute.** Both limits have brakes.

---

## Money, and the one number that keeps being wrong

The Netlify allowance is **1000 credits a month**, not the 300 that `AGENTS.md`
and `scripts/lib/netlify-credits.mjs` claimed until 2026-09-17. That figure
came from a comment and was quoted as fact for weeks. The live reading that
day was 369/1000 projected.

A production build still costs 15 credits, and a squash-merge to `main` *is*
that build, so batching merges is still right. But **read the gate before
telling anyone they are near a ceiling**: `npm run credits`, or the CI
"Netlify credit budget" check, which fetches the real allowance every run.

Supabase egress has its own load-shedding gate (`scripts/egress-gate.mjs`),
which defers deferrable cron jobs rather than failing them.

---

## How the platform watches itself

`scripts/check-cron-staleness.mjs` compares every source in
`scripts/lib/cron-pager-registry.mjs` against `scraper_runs` and pushes the
owner once per silent period at 3× the expected interval. A sleeping PC
coalesces into one alert instead of nine. `tests/cron-pager-registry.test.ts`
guards the registry in both directions — every registered source must have a
real writer, and every writer must be registered.

Four budget and uptime guards sit alongside it: egress, Netlify credits, a
live-URL watchdog, and the staleness pager itself.

**What it does not do is propose.** Nothing observes the platform over weeks
and says what should change. `/admin/ai-editor` can propose a cron trigger and
the patch-note job drafts copy, but there is no standing review. That gap and
this file are the two halves of the same problem: the platform can repair
itself but cannot remember or reflect.

---

## Things that will bite you

1. **The changelog no longer lives in the repo.** As of 2026-09-18, patch
   notes are rows in `patch_notes` (migration 0250), drafted by the daily job
   and published from `/admin/whats-new`. The 40 markdown files under
   `src/content/patch-notes/` are the back-catalogue and still render. Do not
   add a new `.md` note — it would cost a build, which is the whole reason
   this moved.
2. **A branch that looks unlanded may already be merged by content.** Release
   PRs squash several branches at once, so GitHub never marks the sources
   merged and they stay permanently "ahead". Test-merge into `origin/main` and
   read the *resulting* diff before concluding anything.
3. **`next build --webpack` must not come back.** It OOM'd the Netlify
   container at ~2034MB and froze the site. The history is in the comment at
   `netlify.toml:68`.
4. **Generator output is never publishable copy.** Raw commit subjects once
   shipped an editor instruction onto the public page. Anything a model writes
   for a public surface gets a human read first.
5. **Parallel sessions share one checkout.** Run `npm run preflight` before
   every commit. See standing rules 8 and 10 in `AGENTS.md`.

---

## Where the forward plan is declared

There is no roadmap file in this repo, but the plan is not a secret — it is
visible in surfaces users already see:

| Source | What it declares |
|---|---|
| `src/config/site.config.ts` | Four flags held `false`: `proSubscription`, `medicalRecruitment`, `aiPersonalization`, `briefMvpTeaser` |
| `src/app/leader/page.tsx` | The leader workshop: 3 tools live, 7 marked "soon" or "planned", rendered to leaders |
| `src/app/membership/page.tsx` | What the Pro tier would include |
| `docs/APP_STORE_PACKAGING.md` | Android $25 once, iOS $99/yr plus a Mac, desktop already shipped |
| `docs/VISION.md` | What winning means: 10,000 advocates, 50 per contested state, 20 signups per partner shop per month |

The shape across the codebase: **everything that reads the world is close to
done; everything that recruits a human is not.** Bills, money, news and
meetings refresh themselves. Referral attribution, leader field tools,
app-store presence and medical outreach are where the work is left — and
`docs/VISION.md` measures winning entirely in those terms.

---

## Keeping this file honest

Update it when you learn something a future session would otherwise
rediscover, or when one of the "stale belief" rows above stops being true.
It is top-level markdown, so a change costs no build and no credits.

It is a public file in a public repository. Nothing goes in it that would not
be safe on the front page: no keys, no email addresses, no personal
information, no unannounced plans.
