# iKratom — Master Roadmap

_Living doc. Last updated 2026-05-15 — overnight push shipped PRs #280–#283 layering takeback intel, neutral templates, news correlation, and admin observability on top of the May 13–14 intel-network buildout._
_See companion docs for deep dives: `docs/OVERNIGHT_2026-05-15.md` (latest handoff), `docs/NY_COMPLETION_CHECKLIST.md`, `docs/MULTI_STATE_EXPANSION.md`, `docs/NY_INTEL_DEPTH_AND_AI_ROADMAP.md`, `docs/ROADMAP-NEWSROOM.md`, `docs/USER_TODOS.md`, `docs/VISION.md`, `SECURITY.md`, `APP_STORE_READINESS.md`._

---

## Where we are right now

**Production**: Vercel runtime logs show 0 errors / 0 warnings / 0 5xx in last 24h. Migrations 0123 + 0124 + 0125 applied. 37+ PRs merged this stretch. **34 actors in the kratom-industry intel registry, all citing public-record evidence. 131 LDA lobbying filings indexed. Federal donor profiles populated for 257 of 531 federal legislators.**

**Three feature complexes are live across the platform:**

| Complex | Surfaces | What it does |
|---|---|---|
| **Committee-urgency** (Phase 1) | `/bills/[id]` callout · `/dashboard` widget · `/pulse` chip · `/alerts/[id]` callout · `/legislators/[id]` section · `/bills?filter=in-my-committees` · `/legislators/committee` · `/status` stat | When a bill sits in a committee where the signed-in user's rep serves, surface that as urgency everywhere. Mission-lever: bills die in committees; constituents of committee members have the only real leverage. |
| **Intel-briefing** (Phase 2) | `/legislators/[id]/briefing` per-person · `/states/[code]/briefing` per-state triage · `/intel` hub · `/intel/lobbying` LDA filings · `/intel/actors` registry · cross-references on briefings | "True intel agency work" — rule-based action plan per legislator, faction-tagged actor registry, federal lobbying disclosures all in one navigable structure. |
| **URL auto-fill** | `/admin/library/new` · `/admin/library/new/quick` · `/admin/library/[id]/edit` · `/alerts/submit` | Paste YouTube/article URL → AI fetches metadata → review & save. Library item creation went from 30s of typing to 3s of glancing. |

---

## Phase A — Committee urgency (✅ shipped May 13–14)

The mission lever the platform's entire shape exists for. When a bill sits in committee, only the ~10–20 legislators on that committee can vote it out. Of those, only their constituents have leverage.

| PR | What | Where |
|---|---|---|
| #223 | "YOUR rep is deciding this bill" callout. Migration `0123` + `src/lib/bill-committee.ts` parser. | `/bills/[id]` |
| #224 | LegiScan sync writes `current_committee_name` hourly. | `scripts/sync-bills-via-legiscan.mjs` |
| #225 | `/legislators/committee?name=X` chair-first member roster. | New route |
| #227 | 20 vitest cases for parser + matcher; caught a real regex bug, hardened with negative lookahead. | `tests/bill-committee.test.ts` |
| #228 | `MyCommitteeBillsWidget` dashboard widget. | `/dashboard` |
| #230 | `is_kratom_relevant` battleground accent (amber instead of emerald for admin-flagged committees). | `/bills/[id]` |
| #231 | Form B regex (`Chamber Committee on Body` → canonicalized). Without this most OpenStates bills weren't parseable. | parser + backfill |
| #232 | OpenStates daily sync writes `current_committee_name` on every refresh. Daily-cron safety-net backfill. | sync + cron |
| #233 | `/bills?filter=in-my-committees` pre-filtered browse view. | `/bills` |
| #234 | `/status` public committee-leverage stat. | `/status` |
| #236 | `⚡ Your rep decides` chip on `/pulse` alert cards. | `/pulse` |
| #237 | "Currently deciding" section on legislator detail pages. | `/legislators/[id]` |
| #238 | Callout mounted on `/alerts/[id]`. | `/alerts/[id]` |
| #245 | Donor-sync pipeline bugs fixed (broken `/by_industry/` endpoint + invalid sort param + employer-name categorization). | sync |

**Coverage**: 30 of 467 active bills now have `current_committee_name` populated (NJ:20, TN:3, WA:3, AL:3, CO:1). OpenStates daily sync keeps it fresh. Remaining 437 mostly use chamber-less action text ("Died In Committee" etc.) and correctly stay null.

---

## Phase B — Intel-briefing system (✅ shipped May 14)

Per-legislator action plans grounded in real research. Sourced from Senate LDA (no auth), ProPublica Nonprofit Explorer (no auth), OpenFEC (key required, in env), Tampa Bay Times "Deadly Dose" investigation series, Courthouse News "Inside kratom's political underbelly", and platform-owner first-hand observations clearly labeled.

| PR | What |
|---|---|
| #240 | `/legislators/[id]/briefing` — stance + leverage signals + rule-based action plan + 7 sections per person |
| #241 | Donor-sync `--all-federal` + smarter candidate matching |
| #242 | `/states/[code]/briefing` — 6-bucket state-level legislator triage |
| #243 | Stance chip + briefing CTA on dashboard `MyRepCard` |
| #244 | Briefing CTAs on urgency callouts + committee roster |
| #246 | "Preview brief" link in `/admin/stance` row |
| #247 | LDA lobbying-filings pipeline + migration 0125 + `/intel/lobbying` + `/intel` hub |
| #248 | Kratom-industry actor registry (23 actors initially) + `/intel/actors` |
| #249 | Cross-reference industry actors on legislator briefings |
| #250 | Major registry corrections — factional restructure (split `aka_aligned` into `aka_coalition` + `gkc_coalition`) + 7 new actors (J.W. Ross, Matthew Lowe, Kelly Dunn, Curt Bramble, Vernon Jones, Markwayne Mullin, Center For Plant Science and Health) |
| #251 | Library quick-add URL auto-fill |
| #252 | URL auto-fill extended to `/alerts/submit` + `/admin/library/[id]/edit` |
| #253 | Multi-state KCPA wave registry expansion — 9 new actors (Rivero AZ / Yeager+Wheeler NV / McKell+MacPherson+Hall UT 2026 / Chris Bell / OPMS supply chain) + Vernon Jones upgrade from owner-testimony to documented co-sponsor |
| #254 | Speed-up tooling — `npm run verify` (3.7× faster than build), repo settings flipped via gh api |

### Intel-network — current state

- **34 named actors** with public-record evidence URLs across 5 factions (`aka_coalition`, `gkc_coalition`, `pro_7oh`, `cross_coalition`, `regulator`, `academic`)
- **131 federal lobbying filings** indexed (LDA, 2016 → 2026)
- **257 federal donor profiles** matched (~50% of 531 federal legislators)
- **AKA + GKC 990 financials** indexed: $4.5M and $3M respectively, with structural deltas (AKA member-dues model vs GKC single-funder shell)
- **Multi-state KCPA wave (2019)** fully mapped: UT-Bramble → GA-Jones → AZ-Rivero → NV-Yeager/Wheeler
- **LDS-network influence pipeline** documented: Hatch 1976 → DSHEA 1994 → Haddow → Bramble → 4-state wave → 2026 Utah "Word of Wisdom" stunt
- **Influence-laundering chain** documented: Urban Ice $ → kratom research → "A Leaf of Faith" doc → Netflix → Joe Rogan → policy advocacy
- **OPMS Indonesia supply chain** documented: West Kalimantan → Pontianak port → Oakland/Tampa (Indonesian gov DENIED Tampa Bay Times's journalist visa to Pontianak — active press blockage)

---

## Phase C — IA / UX cleanup (✅ shipped May 13–14)

| PR | What |
|---|---|
| #137 | P0 IA polish (admin reorg + dashboard reorder + account sidebar + /submit hub + leader collapse) |
| #221 | ReplayTourButton moved to dashboard header; auto/manual badge column on `/admin/campaigns` |
| #222 | `/dashboard/templates` rehosted to `/account/templates` + orphan `sync:capitals` archived |
| #226 | ROADMAP refresh capturing committee-urgency trilogy |
| #229 | News title cleanup — strip TV-callsign suffixes (`KTVB`, `WCYB` etc.) that 0105 migration missed |
| #235 | ROADMAP refresh after intel work |
| #239 | ROADMAP refresh for 5-surface committee-urgency saturation |

---

## Phase F — Banned-state takeback + correlation + observability (✅ shipped May 14-15)

The May 14–15 push extends three threads of the prior work: (a) making the banned-state intel real and discoverable, (b) connecting the news pipeline back to the bills it's about, (c) lowering the admin's signal-to-noise so they don't drown in fake queues.

| PR | What |
|---|---|
| #280 | 8-part directive: /states/[code] active-vs-zombie filter + Suffolk visibility, /bills/[id] news coverage, **neutral campaign templates** (migration 0142), bill-anchor guard on auto-campaign trigger, home page mission framing + stat strip, /admin honest stats + force-dynamic, sync auto-resolver keyword tie-break |
| #281 | /takeback hub — every banning state's offense + defense in one page, with admin-rule vs statutory grouping |
| #282 | /states/[code] news coverage (same dedup pattern as bill detail page) |
| #283 | /admin/intel-health queue + freshness watch (6-row drift dashboard) + experimental backfill-alert-bill-linkage script (skeleton for future news→bill correlation) |

### Data work applied live alongside the PRs

- Migration 0141 — `opposition_summary_md` + `repeal_plan_md` columns on bills
- Migration 0142 — neutral templates + bill-anchor guard in trigger
- Editorial seed: 7 banning states (AL/AR/IN/RI/VT/WI/TN) + 24 named stakeholders
- Suffolk County: 18 sitting legislators backfilled with web-verified email/phone/party
- 21 Suffolk policy_alerts retroactively linked to bill_id 56286cb1 + 5 mis-localities fixed
- 238 pending news-only auto-campaigns mass-rejected (queue 239 → 1)
- 13 sync discrepancies auto-resolved via keyword tie-break (queue 22 → 9)
- 2 misclassified bills fixed: ME LD 1546 → status='dead', TN SB 1656 → status='introduced'

### Cross-state pattern captured on /takeback

- AR / RI / VT are admin-rule bans → easiest repeal targets (no legislative vote)
- AL / IN / WI are statutory → need a KCPA bill carrier
- TN HB 1649 is imminent → pre-signature veto pressure is highest-leverage moment

---

## Phase D — Open work (next in queue)

### D1. Voting records (medium leverage, medium effort)
**~2 hours.** Extend `scripts/sync-bills.mjs` to pull OpenStates `include=votes` field + write to new `bill_votes` table. Per-legislator roll-call history becomes a briefing field. **Unblocks:** "Sen. X voted YES on 2024 KCPA so she'll likely vote YES on 2026 bill" predictive intel.

### D2. NY Senate committee scraper (high leverage, blocked on tooling)
**Cloudflare-blocked at nysenate.gov.** Free workaround: use Claude in Chrome MCP to drive a logged-in browser one committee at a time. Paid workaround: Browserbase ($39/mo). Until done, NY committee coverage is Assembly-only.

### D3. State-level lobbying disclosures (Phase 3, multi-state scraping effort)
**50 different state lobbying-disclosure portals.** Per the AKA $4.4M-over-5-years figure cited in the Tampa Bay Times investigation, state lobbying spend dwarfs federal. Each state portal needs its own scraper. **Pilot recommendation: UT first** (LDS network + Bramble payment trail) → FL (DeSantis kratom bill + OPMS supply chain) → CA (GKC's home state).

### D4. STOCK Act federal personal-investment disclosures
PDF parsing. Periodic Transaction Reports for House + Senate members. Would expose more conflicts of interest beyond donor PACs (Mullin/Botanic Tonics pattern repeated for others).

### D5. Press release scraping per legislator
**Different news ingestion source needed first.** Current news pipeline pulls kratom-policy news; would need to add a per-legislator-website press-release scraper. Cross-references back to the briefing's "intel gaps" section.

### D6. State legislator stance drafting at scale
**Script exists** (`scripts/draft-legislator-stance.mjs`) but is gated by AI router rate limits. Daily cron currently runs `--priority-only` (10 states). Once that queue is drained, switch to `--all-states` weekly cadence. Need owner sign-off on token budget.

### D7. Self-critique loop on AI outputs (per `NY_INTEL_DEPTH_AND_AI_ROADMAP.md` item C)
Wrap `generate-state-briefing.mjs` in critique loop. AI generates → second AI critiques → regenerate if flagged → ship best-of-N. Half-day effort.

### D8. Vector memory + cross-state similarity (per same doc, item B)
pgvector extension + `mxbai-embed-large` via Ollama. Cross-state bill similarity ("MI just introduced — 87% match to TX HB 5 2024"). One-day effort.

### D9. Self-improvement feedback loop (item E)
`ai_decisions` table + `recordAdminAction` hook + weekly failure-mode report. Six hours.

### D10. Admin dashboards over all signals (item F)
Briefing freshness per state, stance coverage per state, committee coverage, FP rates, cron health. Six hours. **Partial credit shipped in PR #283** — `/admin/intel-health` got a 6-row queue + freshness watch at the top (campaigns pending, sync discrepancies, intel tips, local fights, stale briefings, stance coverage link). Per-state expansion still TODO.

### D11. News → bill correlation (added 2026-05-15)
The /bills/[id] news-coverage section relies on the `policy_alerts.bill_id` chain. Only ~5% of approved alerts have a bill_id linked. The PR #283 experiment confirmed bill numbers don't reliably appear in alert titles — the signal lives in `news_items.body` and `news_items.summary`. **Plan**: regex-extract bill numbers from news_items body text, match against bills in same state, populate a direct `news_items.bill_id` column (new migration). Would 10x the news shown per bill detail page. Half-day effort + needs precision testing on edge cases (NY S 5 vs NY S 5531 etc.).

### D12. Stale-title bill cleanup (added 2026-05-15)
39 bills have title mentioning kratom but `summary_long` about something else (LA SB 154 pattern — session bill-number reuse). Two fix paths in `docs/OVERNIGHT_2026-05-15.md`. Recommended: modify `scripts/sync-bills.mjs::classify()` to also consider summary_long when present + downgrade to 'neutral' when title and summary disagree. Or: title refresh from upstream during each OpenStates sync.

---

## Phase E — Long-defer (intentional)

- **App store listings** (Google $25 + Apple $99/yr) — paid; defer until revenue starts
- **Browserbase** ($39/mo) — Cloudflare-bypass scraping. Free workaround: Claude in Chrome MCP, slower but works
- **Twilio** — current `tel:` + Web Speech approach is free and works for 80%
- **Vercel Pro** ($20/mo) — current Hobby + GitHub Actions sub-daily cron works
- **Medical-pro recruitment** (`siteConfig.features.medicalRecruitment: false`) — v2
- **AI personalization** (`aiPersonalization: false`) — v2

---

## User-side waiting list (the only things blocked on you)

Listed in priority order. See `docs/USER_TODOS.md` for the full free-tonight checklist.

1. **PostHog key in Vercel env** — `NEXT_PUBLIC_POSTHOG_KEY` not set in deploy env yet, so prod doesn't fire client-side events. MCP is connected but seeing 0 pageviews because of this. ~30s.
2. **Brave Search API key** — `BRAVE_API_KEY`. Backup grounded search when Gemini hits quota. Free 2k/mo. ~5min signup.
3. **GlitchTip or Sentry DSN** — error monitoring. `SENTRY_DSN` env var works for both. Free tier on each. ~5min.
4. ~~**Home page A/B/C pick**~~ — superseded 2026-05-14. Canonical home (`/`) was revamped in PR #280 with the new mission framing + stat strip + Takeback CTA. The `/home-a` / `/home-b` / `/home-c` variants remain as A/B refs but `/` is the canonical landing.
5. **R2 bucket creds** — activates in-app video uploads. Cloudflare R2 free tier exists. ~10min.
6. **Stance review** at `/admin/stance?state=NY` — 153 AI-drafted stances need 5-10s clicks each. Focus on champions (8) and hostiles (16). ~30min for spot-check or full review.
7. **PWA install test** on phone — verify `/install/android` and `/install/ios` flows. ~5min.
8. ~~**Enable repo auto-merge**~~ — gated by GitHub Pro on private repos; user chose to skip ($4/mo).
9. ~~**OPENFEC_API_KEY**~~ — done.
10. ~~**OpenSecrets API key**~~ — discontinued April 2025 (api no longer free). Bypassed via Senate LDA + ProPublica 990s + direct FEC PAC tracking.

---

## How to know we're "done with NY" (the model state template)

Per `docs/NY_COMPLETION_CHECKLIST.md`: a stranger NY advocate visits `/briefings/state/NY` and within 60 seconds knows their champions + hostiles + committees + sponsors + field-work. Currently **6.5 of 7 green** (Senate committees missing per D2).

---

## Open intel branches (where to push next per owner ask)

1. **Trace Botanic Tonics → MAHA PAC → Mullin → RFK pipeline** through any other vehicle. Specifically: RFK Jr's HHS appointments and whether any kratom-positioned officials are landing inside HHS / FDA / DEA leadership.
2. **AKA complete 990 officers list** via ProPublica detail endpoint (we have aggregate financials, not officer names).
3. **State lobbying disclosure pilot** — UT (LDS / Bramble) first.
4. **Salt Lake City kratom summit** — who organized, who paid for venue, attendee list. Currently this is the only owner-testimony-only line item in the registry.

---

## Repo health snapshot

- Production: 0 errors / 0 warnings / 0 5xx in last 24h (Vercel runtime logs)
- 27 vitest tests, 100% pass (parser + matcher + civic + rate-limit + setup)
- ESLint: configured, runs in `npm run verify:full`
- TypeScript: strict, no errors
- Migrations: 125 applied
- Dependencies: no known security advisories
- Auto-merge: disabled (GitHub plan-gated)
- `npm run verify` = typecheck + tests = ~9s; full `npm run build` = ~33s
