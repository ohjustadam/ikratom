# State of play

**The in-repo cold-start brief. Read this first.**

The owner's working plan lives in `private/PLAN_OF_ACTION.md` on his own
machine (`AGENTS.md` tells you to start there). `private/` is gitignored, so it
does not exist in a fresh clone — which means it does not exist for any session
running anywhere else. Cloud
sessions have repeatedly had to re-derive the state of the platform from
scratch, and one of them re-derived it wrongly.

This file is the public half of that brief: everything a new session needs
that is safe to commit to a public repository. It carries no secrets, no
owner PII, and nothing about an unannounced plan. What only the owner can do
lives in ONE list, `private/OWNER_TODO.md` on his machine (2026-10-23; the old
public root copy was absorbed into it). A session without `private/` asks
him for nothing outside its task, and lists what only he can do in its PR body.
When the private plan is present it wins on any conflict, but when it is not
there, this file is the map. On the owner's machine, the session mesh
(`scripts/session-mesh.mjs`, AGENTS.md rule 11) also tells you which other
sessions are working right now.

It lives at the repository root on purpose. `netlify.toml`'s build `ignore`
rule skips a build for top-level markdown (`:(exclude,glob)*.md`, and git's
glob magic stops `*` at a `/`), so changing this file costs nothing. A file
under `docs/` would be free too; one under `src/` would not.

_Last hand-verified: 2026-10-17, against `main` at f2ecac3._
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

| Thing | Reality | Note |
|---|---|---|
| Hosting | **Netlify**, `netlify.toml`, behind Cloudflare | Older docs said Vercel; corrected 2026-10-17 |
| Cron | **GitHub Actions**, started on time by Supabase `pg_cron` (migration 0263) | `vercel.json` `crons` is `[]`; workflow `schedule:` is a deduped fallback |
| Request middleware | **Disabled** — `src/proxy.disabled.ts` | Since 2026-07-26 |
| Bot blocking | **Cloudflare Bot Fight Mode** + anonymous page caching | The UA blocklist left with the proxy |
| Public page reads | **Cloudflare R2 snapshots** (#990, #994, #996) | Legislator, briefing, State HQ, bill, research pages read Supabase at most once per 12h |
| Database | Supabase Postgres, RLS on every table | — |
| AI | Free providers only, via `scripts/lib/ai-router.mjs` | See `docs/AI_PROVIDERS.md` for which keys exist |

The proxy was renamed, not deleted, when the Netlify adapter could not bundle
Next 16 middleware. Security headers and CSP were unaffected — they are
enforced from `next.config.ts`. Two things it used to do have **not** been
restored:

- the account-lock / force-password-change redirect (data is still
  RLS-protected; this was the UX bounce to `/locked`)

Attribution capture was **not** one of them, contrary to what reading the
proxy's comment block suggests. PR #845 rebuilt it as a client island plus
`src/app/api/attribution/route.ts`. Partner QR scans were silently rejected
there until 2026-09-18 (a hostname regex demanded a dot, and shop slugs have
none); release #928 fixed it and restored the 60-day window.

**The lesson outlives the bug:** a rejected referral is indistinguishable from
a visitor who arrived without one. Nothing logged, nothing alerted, and it
survived seven weeks. Verify attribution by exercising it, not by reading it.

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

**2026-10-02: the credit gate was right and the site still went down.** One
rented server replayed ~440 server-rendered URLs about 28 times each for 25
minutes. Those renders (~6.5s each, 30s on timeout) burned ~635 credits, the
account hit its cap three days before reset, and Netlify disabled the site. The
gate's estimate was accurate for the baseline. It cannot see a burst: it models
compute from bandwidth (which stayed flat) and is sampled once a day by a
GitHub schedule that runs hours late. Three things follow, and none of them are
fixed by a better estimate:

- **The true meter is readable now, but only after the fact.** Since
  2026-10-03 `scripts/lib/netlify-credits.mjs` reads Netlify's billing
  endpoint (CI prints `TRUE METER`); it still samples, so it cannot stop a
  burst mid-flight. Netlify's emails at 50/75/100% are not configurable.
- **The evidence lives in Cloudflare.** `scripts/cf-origin-report.mjs` ranks
  who is spending origin time; Netlify's function logs keep 24h and will not
  load while the site is paused.
- **Prevention has to happen before the origin.** A per-IP rate limit at
  Cloudflare would have stopped this outright, and caching a page for anonymous
  visitors bounds a replay to one render per URL per TTL
  (`scripts/cloudflare-cache-setup.mjs`, `LONG_TTL_PATTERNS`).

---

## State intel: every state watched like Oklahoma (2026-10-23/24)

- **Agency watch, every state + DC.** Each state's health department and
  attorney-general newsrooms and its state register / notice-of-intent page
  are `bop_sources`, verified from GitHub's IPs by
  `scripts/register-state-intel-sources.mjs` (candidates in
  `scripts/data/state-intel-sources.json`; run `intel-sources-verify.yml`).
  Only official .gov / state .us domains are accepted. Florida's AG and
  register and New Mexico's health department are official but not .gov, so
  they are left out.
- **The BoP engine's alert path had never worked.** Its trigger inserted an
  alert kind the database forbids. Fixed in migration 0279: kind follows the
  source (`rule_filed`, `news_break`, `bop_hearing`). A source's first walk is
  marked `is_baseline`, and backlog or press-release hits go to the review
  queue. Unrelated non-PDF links are no longer stored, and PDFs are classified
  in full, not just the first 50KB.
- **Campaign staleness gate** (migration 0278). The alert-to-campaign trigger
  skips an expired alert, a past hearing, a sine-die bill, or a story more
  than 21 days old. `alertStaleReason()` in `scripts/lib/campaign-eligibility.mjs`
  mirrors it.
- **News state tagging.** A story was filed under whichever state's query found
  it, so a Tennessee explainer landed under LA. `scripts/lib/news-state.mjs`
  now tags by the headline at insert, and 1,302 past stories were retagged.
- **Playbook matches.** `scripts/playbook-match-alerts.mjs` runs daily after
  bill embeddings. A live restrictive bill that takes the same approach as
  another state's bill becomes a `watch` alert in the review queue. Any two
  kratom bills score about 0.75, so the threshold is 0.88.
- **Legal status** was re-checked against primary sources on 2026-10-23/24.
  Seven rows had gone stale since June: TN (now banned), WY, OH, VA, DE, RI
  and ND. A "takes effect July 1" note does not update itself, so re-check any
  dated note once its date passes.

## How the platform watches itself

`scripts/check-cron-staleness.mjs` compares every source in
`scripts/lib/cron-pager-registry.mjs` against `scraper_runs` and pushes the
owner once per silent period at 3× the expected interval. A sleeping PC
coalesces into one alert instead of nine. `tests/cron-pager-registry.test.ts`
guards the registry in both directions — every registered source must have a
real writer, and every writer must be registered.

Four budget and uptime guards sit alongside it: egress, Netlify credits, a
live-URL watchdog, and the staleness pager itself.

**It also reflects, weekly.** Every Sunday `scripts/weekly-self-review.mjs`
posts what moved, what decayed and what it would do next as a comment on
GitHub issue #929 (running since 2026-09-20). It catches what the pager
cannot: a job that runs on time and writes nothing. Nothing acts on its
proposals automatically — read them before starting a session.

---

## Officials turnover (built 2026-10-21 → 10-23)

Promise to members: nobody emails someone who has left office, and nobody is
dropped before they leave. One daily job (cron-daily `roster-diff`) runs, in
order:

| Step | Script | Rule |
|---|---|---|
| Roster diffs | `sync-state-roster-diff.mjs`, `sync-congress-roster-diff.mjs` | exact openstates / bioguide ids |
| Swap on the handover day | `turnover-swap.mjs` | retires the incumbent only when openstates/people or congress-legislators shows the successor **in office**; the record is kept |
| Election results | `ingest-election-results.mjs` | Election Day +1 to +60; a winner lands only when a **later day's** reading names the same person |
| Seat watch | `sync-seat-watch.mjs` (every 3 days) | `term_calendar` + `seat_elections` (migration 0277) |

Where the facts come from, all free and keyless:
- **Seats up:** NCSL's per-chamber table. For staggered chambers, the Wikipedia
  election article's district list, accepted only when its count equals NCSL's.
- **Handover day:** a term-start rule that must reproduce the openstates/people
  start dates of the two latest cycles.
- **State `term_end_date`** is set from the SEAT's handover day, never from
  start date + term length, which is wrong for every appointee.

First run (10-23): 6,616 seats flagged on the Nov 3 ballot. Active officials
with a term end went from 1,170 to 6,675 of 13,112.

Known gaps, surfaced on `/admin/local-rep-requests`, never guessed:
- Seat lists unverified: the CO, HI, IN and NV senates, and DC's council.
- No proven handover day: CO, the IA senate, ME, the MN house, WI.
- Local results: there is no machine-readable source. Local rosters rely on
  `refresh-local-rosters.mjs` re-queuing a locality after a term end passes.

**Match people with `samePerson`, never surname alone.** congress-legislators
lists Sen. Darline Graham Nordone as "Darline Graham", and a surname match
"confirmed" her as Lindsey Graham, the senator she replaced.

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
6. **Letters get their iKratom lines at send time, never in templates.**
   The recorder's clip line ("Listen to my 30-second message: <url>") is added
   to the member's own text (`src/modules/campaigns/letter-extras.ts`). The
   footer lives in `src/lib/email/letter-footer.ts`: plain "Sent via iKratom —
   https://www.ikratom.org" for mailto/compose, and the iK logo plus a link in
   the HTML part. `sendOnUserBehalf` sends every letter as text + HTML with
   both, so a new one-click path gets the footer without asking; a new
   compose path must call `withLetterFooter` (`tests/letter-extras.test.ts`
   lists the paths). The logo is `public/ikratom-icon-180.png`: renaming it
   breaks the image in every letter already sent. The clip recorder needs
   `camera=(self), microphone=(self)` in the Permissions-Policy
   (`next.config.ts`): with `()` it silently did nothing from 2026-05 to
   2026-10-24.
7. **Recipient chips show the official record, never a stance label.** They
   read sponsorships and votes (`src/lib/kratom-record.ts`), not
   `legislator_stance`, whose champion/hostile labels no human reviewed.

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
meetings refresh themselves. Leader field tools, app-store presence, medical
outreach and the rough edges in attribution are where the work is left — and
`docs/VISION.md` measures winning entirely in those terms.

---

## Keeping this file honest

Update it when you learn something a future session would otherwise
rediscover, or when one of the "stale belief" rows above stops being true.
It is top-level markdown, so a change costs no build and no credits.

It is a public file in a public repository. Nothing goes in it that would not
be safe on the front page: no keys, no email addresses, no personal
information, no unannounced plans.
