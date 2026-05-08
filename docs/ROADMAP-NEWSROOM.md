# Roadmap: iKratom as the underground newsroom + policy think tank

**Status:** ratified 2026-05-08. Anchors all subsequent feature decisions.

---

## The vision in one sentence

iKratom is the **fastest-to-publish, most-comprehensive intelligence layer** for the kratom policy fight — federal, state, board-of-pharmacy, news, and advocate-sourced — that automatically routes every event into a one-click campaign action available to every member.

Three roles in one platform: **newsroom + think tank + action engine**. The combination is the moat.

## Why this matters

- **Reactive advocacy loses.** When NH SB 557's amendments were 9 days stale in our DB, advocates couldn't act in time. Speed is the whole game.
- **Boards of Pharmacy are a blind spot.** BoPs can schedule kratom administratively without legislation. We track zero of them today.
- **Facebook-group intel evaporates.** Advocates routinely post first-hand intel (county council votes, hearing dates) in private groups; without a structured intake, that intel doesn't reach the wider community.
- **Industry leaders need decoded policy.** The NDCS 2026 briefing proved the appetite. Long-form analysis is a content category nobody else owns.

## Architecture

### Single canonical event store: `policy_alerts`

One table, one pipeline, one notification path.

- `kind` discriminates source: `bill_event` | `bop_hearing` | `fda_action` | `news_break` | `intel_tip` | `scraper_stale` | `briefing_published`
- `severity` drives surface placement: `routine` | `watch` | `alert` | `critical`
- `action_required` flags whether a campaign should auto-spawn
- `locality` scopes the alert: state code, "FED" for federal, "ALL" for nationwide

### Inputs (three tiers)

| Tier | Sources | Cadence | Target latency |
|---|---|---|---|
| 1 — Structured APIs | LegiScan, OpenStates, Federal Register RSS, FDA press releases, FastDemocracy | Hourly | < 1 hour |
| 2 — Semi-structured | State BoP agenda pages, Google News RSS, court dockets | Every 6 hours | < 6 hours |
| 3 — Human intel | Advocate submission form, admin paste, Discord webhooks | Real-time | < 5 min after approval |

### Outputs (four surfaces)

1. **`/pulse`** — live policy feed, severity-gated, no-crowd information architecture
2. **`/alerts/[id]`** — single event detail + auto-campaign CTA
3. **`/bops`** — 50-state Board of Pharmacy tracker with map UI
4. **`/briefings`** (already shipped #47) — long-form analytical briefings with shareable PDF artifacts

### Auto-campaign mechanism

- Each `policy_alert` with `action_required=true` triggers `auto_campaign_create()` RPC
- Campaign gets `mobilization_type`: `constituent` | `solidarity` | `both`
- BoP hearings + federal actions default to `solidarity` (open to all members)
- State bills default to `constituent` (residents only) but can be flipped to `both`
- Solidarity templates use national-community language, not constituent language
- All members get push + bell notification with one-click action

## Reliability strategy

### Freshness monitoring

- `scraper_runs` table logs every cron tick: source, started_at, finished_at, rows_added, status
- `/admin/intel-health` dashboard surfaces last-success-time per source, trends, alarms
- A scraper that returns 0 rows for 2× its normal interval triggers an internal `scraper_stale` alert
- Critical sources missing for 24h+ ping admin via push

### Multi-source corroboration

- High-severity alerts (`critical`) require ≥ 2 sources before fan-out
- Single-source intel from advocates capped at `alert` until admin promotes
- Reduces false-alarm push fatigue

### Failure transparency

- Every alert shows its sources publicly
- Users can flag inaccurate intel via a one-click report
- Repeat-bad-source advocates lose Field Reporter status

## Boards of Pharmacy — 50-state coverage

### Phase 1: static directory (this PR)

- `bop_boards` table seeded with 50 rows
- Columns: state, board_name, website, contact_email, meeting_schedule_url, agenda_format, scraper_config (JSON), last_scraped_at, kratom_stance (`unknown` | `quiet` | `watching` | `proposed_scheduling` | `scheduled`)
- Half the value is just having the contact info ready

### Phase 2: scraper engine

- Generic scraper reads `scraper_config` per board
- Per-state customization stays data-driven, not in code
- Keyword filter: `kratom`, `mitragynine`, `7-OH`, `7-hydroxy`, `controlled substance`, `schedule I`, `schedule II`
- Hits create `bop_hearing` alerts

### Phase 3: BoP coverage map

- `/bops` page with US map UI
- States colored by `kratom_stance`
- Click state → board details, recent activity, contact info, one-click campaign

## Advocate intel pipeline

### Submission

- `/alerts/submit` (logged-in only)
- Fields: state, locality (optional), type, headline, body, source_url (optional), urgency (1-4), anonymous flag
- Rate-limited: 3 per user per day
- New accounts (< 7 days) flagged for stricter review

### Moderation

- `/admin/intel-queue` queue page (admin/owner)
- Three actions per submission: Approve (publish + notify), Reject (with optional note back to submitter), Need-more-info (DM the submitter)
- Approval converts the submission into a `policy_alert` with `kind=intel_tip`

### Trust system

- Approved-intel count shown on user profile as "Trusted Reporter" badge
- 10+ approved intel + zero retracted → Field Reporter role with auto-approval (admin-revocable)
- Repeat unreliable submitters auto-blocked from intel form

## /pulse — information architecture

Severity-first, recency-second. Maximum cards per zone:

- **Today's Breaking** — `severity=critical`, max 3 cards, expires after 24h or when superseded
- **This Week** — `severity=alert`, max 5 cards, expires after 7 days
- **Active Campaigns** — non-expired campaigns sorted by deadline
- **Background** — long-form briefings + bill journeys + trending news, max 5 each

Rules:
- Severity gates prominence, not recency alone
- A `routine` bill introduction never bumps a `critical` BoP hearing
- Campaigns linked from alerts get a "from this alert" badge
- Map view available as a toggle for visual learners

## Action plan — phased

### Phase 0 (this PR — foundations)
- [ ] Migration: `policy_alerts` table
- [ ] Migration: `bop_boards` table seeded with 50 states
- [ ] Migration: `scraper_runs` table
- [ ] Migration: campaigns gain `mobilization_type` column

### Phase 1 (next 1-2 PRs — Pulse v1)
- [ ] `/pulse` surface (read-only, no submissions yet)
- [ ] Auto-create `policy_alert` rows for every existing `bills` row update (back-compat)
- [ ] Push notification fan-out per severity tier
- [ ] `briefing_published` alert auto-fired when a new briefing is committed

### Phase 2 — BoP scraper
- [ ] Scraper engine reading per-board `scraper_config`
- [ ] Hourly cron for all 50 BoPs
- [ ] `/bops` map UI

### Phase 3 — advocate intel
- [ ] `/alerts/submit` form
- [ ] `/admin/intel-queue` moderation
- [ ] Trust badge + Field Reporter role

### Phase 4 — auto-campaigns
- [ ] `auto_campaign_create()` RPC
- [ ] `mobilization_type` switching across templates
- [ ] Solidarity-action UX on /pulse

### Phase 5 — health monitoring
- [ ] `/admin/intel-health` dashboard
- [ ] Alarm on stale sources
- [ ] Multi-source corroboration logic

## Out of scope (intentionally deferred)

- AI-generated alerts (we want human-curated severity for v1)
- Cross-jurisdictional pattern detection ("3 states proposed scheduling in 30 days")
- Embeddable widget for industry partners' websites
- Public API for third-party integrations
