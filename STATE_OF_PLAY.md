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
- **One finding per press release (2026-10-29, #1083).** A newsroom item used to
  be stored twice, once as a link and once as the heading or table row around
  it, and both copies alerted. The extractor now drops the url-less copy.
  Also fixed: the Cloudflare AI lane returned the API envelope as the answer
  when Gemma 4's thinking used up `max_tokens`, so 12 kratom findings were
  stamped "classified" with an empty verdict and never alerted. Watch for
  `ai_classified_at` set with `ai_relevance` null: that is this bug again.
- **Sources that block GitHub's IPs** run in the Playwright lane
  (`adapter = playwright_browser`): TN Health, TN AG, AK public notices, AL
  pharmacy board. The TX Register fails in both lanes and still needs a
  different URL.
- **News bodies behind Akamai (2026-10-29, #1092).** TEGNA's TV sites (KING5,
  WWLTV, WKYC, 11Alive…), HHS.gov and GlobeNewswire serve Akamai's "Access
  Denied" page to plain fetch and to headless Chromium, even from a home IP.
  329 stories showed that page as their body. The extractor now rejects it and
  stamps those stories with no body. Their reader page links out to the source.
  Never clear `news_items.body_extracted_at` to force a re-extract: every news
  feed lists only rows that have it. Clearing `body_paragraphs` is enough.
- **Legal status re-check, 2026-10-29/30.** The 43 rows without a recent
  confirmation were checked against primary sources and stamped, so all 51
  are confirmed. Four were wrong:
  - **MA is banned**: 105 CMR 726.000 puts the plant in Schedule I from Aug 28,
    2026, for one year.
  - **KS leaf is legal**: the enrolled HB 2365 schedules only 7-OH, although
    the legislature's own summary says mitragynine too.
  - **FL 7-OH is restricted**: Emergency Rule 2ER25-1/-2 covers only 7-OH
    concentrated above 1%.
  - **NC is legal, not restricted**: the under-18 bill we cited (HB 747, 2016)
    never became law, and the General Assembly's own analysis calls kratom
    unregulated.

  The last five needed sources that bill trackers miss: Arkansas's rule on
  codeofarrules.arkansas.gov, the 2026 Indiana Code, DC's 22-B DCMR 1201 (a
  .doc behind a "View Text" button on dcregs.dc.gov), and CDPH's Jan 9, 2026
  letter (cdph.ca.gov answers 403 to scripts, but a browser loads it).
  Re-check KY on Jan 1, 2027 (the HB 757 sales ban, Acts Ch. 161 §136) and MA
  on Aug 28, 2027.
- **A confirmed status shows only confirmed values.** Until 2026-10-30 the
  state hub's status header (and the dashboard's district widget) filled a
  blank 7-OH status with the nightly derivation. In 27 states that put a
  guessed 7-OH label next to "✓ confirmed", and in MI, NJ and NY the guess was
  "Banned", taken from bills that never passed. A blank now reads "Not yet
  classified". A bill is cited as the basis only when it is enacted law that
  agrees with the confirmed status.
- **One status, everywhere.** `state_status.admin_leaf_status` is the confirmed
  status. The home page counts, the maps, `/banned` and the state hubs read it.
  Until 2026-10-29, the forum state pages, `/admin/legislators` and the
  briefing generator read the legacy `states.kratom_status`, which had drifted
  for 23 states. As a result, the AI briefings told readers kratom "remains
  legal" in CT, MA and TN, all three of which ban it. Two fixes went in:
  - Migration 0303 adds a trigger that copies every confirm into the legacy
    column.
  - The briefing prompt now opens with the confirmed status, because the
    critic reads only the first 4000 chars. A text check
    (`scripts/lib/briefing-status-check.mjs`) blocks saving any draft whose
    Snapshot contradicts it.

  All 51 active briefings passed that check after a regeneration the same
  night.
- **State-status audit rows were never written.** `admin_audit_log.target_id`
  is a uuid column and every confirm passed a state code, so the insert failed
  and nobody read the error. `recordAdminAction` now moves a non-uuid id into
  `details.target` and logs insert errors. The 46 B2 confirms were re-recorded.
- **Live-node audit, 2026-10-29** (`/admin/intel-health/states`): 3 of 51 states
  pass all four checks (MI, OH, OK). Intel coverage, legislator email reach and
  status pass almost everywhere. The open gap is people: only CA, MI, OH and OK
  have 3+ advocates.

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

**Who won, and how much of it we can read (measured 2026-10-27).** Legislative
winners come from each chamber's Wikipedia election article; statewide
offices come from the single-race article's infobox ("Elected Governor"). On
the 2022 pages the reader found 20/20 governors, 18/18 attorneys general and
14/14 secretaries of state. Most 2026 chamber pages carry an "Elected" column
the reader parses. Some have no table it can read yet: the IL, IN, ME, MO, SD
and VT houses, the ME/SD/UT/NH/NV senates, and the PA chambers' per-candidate
layout. Seats there get no reading. Their profiles stop saying "Results pending"
on the handover day, and the daily roster diffs retire whoever left, once
openstates/people shows it. Several states' terms begin on or right after
Election Day: FL, TN and HI on Nov 3; AL, IN, NV and DE on Nov 4; SC on Nov 9.

Known gaps, surfaced on `/admin/local-rep-requests`, never guessed:
- Seat lists unverified: the CO, HI, IN and NV senates, and DC's council.
- No proven handover day: CO, the IA senate, ME, the MN house, WI.
- Local results: there is no machine-readable source. Local rosters rely on
  `refresh-local-rosters.mjs` re-queuing a locality after a term end passes.

**Match people with `samePerson`, never surname alone.** congress-legislators
lists Sen. Darline Graham Nordone as "Darline Graham", and a surname match
"confirmed" her as Lindsey Graham, the senator she replaced.

---

## Groups (coalitions), built 2026-10-21 → 10-25

Groups are how a local community organizes. Module `src/modules/coalitions`,
pages under `/coalitions/[slug]`, migrations 0153, 0273, 0274,
0283_coalition_events and 0284.
The first real community is "Rein In Chaos Coalition" (MI, private).

- **Join:** one reusable group link + QR per group (single-use links stalled the
  first group: 6 made, 0 used). Public groups also take "Ask to join".
- **Home:** a cover theme (preset gradients, no uploads), member faces, a one-tap
  Invite through the phone's share sheet, and Home / Events / Members / About tabs.
- **Act together:** "this week's group action" with a members-acted bar, and a
  "wins" card (`coalition_wins()`). Both show counts only, never who.
- **Events and call-in days** (`coalition_events`, `coalition_event_rsvps`):
  organizers post them, and members RSVP and add them to a calendar (private
  `.ics` or a Google link). Reminders go to RSVPs the day before and again
  within 2 h. The hourly `fire-waves` route inserts notification rows, and
  `fanoutPushNotifications` delivers them.
- **Welcome checklist:** derived from what people actually did. Members: join,
  introduce yourself, take the action, invite one. Organizers: share the link,
  pin a welcome post, pick the action, plan an event.
- **Board:** private threads + replies, with one organizer-pinned post; a trigger
  stops anyone else from pinning.

Privacy, everywhere: `@handle` only. A private group 404s for outsiders. RSVPs
are own-row-only, and everyone else sees counts.

Not built yet: reporting group content (waits on B4b's shared report system),
editing an event's time (cancel and re-post), and a real cover photo.

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
8. **Member emails count clicks through `/e/<kind>/<page>`.** The route
   `src/app/e/[kind]/[[...path]]` 302s to `<page>` (only ever an iKratom
   page: `clickTarget` blocks open redirects), and `scripts/email-clicks.mjs` counts the
   redirects in Cloudflare's analytics (the free plan sees paths, not query
   strings; it keeps ~31 days). The sender checks the redirect at the Netlify
   origin before every run and sends plain links if it fails ("links plain" in
   the `scraper_runs` note), so never tag a link outside `emailLink()`. The
   numbers decide how much of a story an email carries (owner, 2026-10-29).
9. **Row rules check who wrote a row, not what it says.** A policy like
   `author_id = auth.uid()` still lets a member write any value into the
   counters and moderation columns of their own row. Migration 0302 closes this
   with BEFORE INSERT/UPDATE triggers that reset those columns for
   non-moderators (`guard_member_content_insert`, `guard_story_update`). Any new
   member-writable table with counts, pins or a review status needs the same
   guard, plus a case in `scripts/rls-pentest.mjs`. That script runs weekly in
   `cron-weekly.yml` (source `rls_pentest`). It attacks production as a real
   member and as a visitor, inside transactions that always roll back.

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
