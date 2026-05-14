# iKratom — Audit + Roadmap

_Living doc. Updated 2026-05-14 — committee-urgency feature set saturated across 5 surfaces (PRs #223–#238). Migration 0123 + 0124 applied; backfill ran; 30 bills with structured committee assignments across NJ/TN/WA/AL/CO. PostHog + Vercel MCPs connected. Production health: 0 errors / warnings / 5xx / 4xx in last 24h (Vercel runtime logs)._
_See `SECURITY.md` for the security side, `APP_STORE_READINESS.md` for store path._

## Committee-urgency feature (shipped 2026-05-13 → 14)

The mission lever the platform's whole shape exists for: when a bill sits in committee, only the ~10-20 legislators on that committee can vote it out. Of those, only their constituents have leverage. Lobbyists target precisely; advocates almost never do.

| PR | What | Where |
|---|---|---|
| #223 | "YOUR rep is deciding this bill" callout when signed-in user's rep is on the bill's current committee. Migration `0123_bill_current_committee.sql` adds `bills.current_committee_name` + chamber + updated_at + inline backfill from `bill_actions`. New `src/lib/bill-committee.ts` parser. | `/bills/[id]` |
| #224 | Wires the same regex into the hourly LegiScan sync so `current_committee_name` stays fresh as bills move through committees | `scripts/sync-bills-via-legiscan.mjs` |
| #225 | `/legislators/committee?name=X` chair-first member roster — backs the no-match fallback link from #223 | New route |
| #227 | 20 vitest cases for the parser + matcher. Caught a real regex bug on multi-chamber strings and hardened with a negative lookahead. | `tests/bill-committee.test.ts` |
| #228 | `MyCommitteeBillsWidget` dashboard widget — shows every active bill in committees where the user has a rep | `/dashboard` |
| #230 | `is_kratom_relevant` accent: matches in admin-flagged battleground committees render in 🔥 amber instead of ⚡ emerald | `/bills/[id]` |
| #231 | Form B regex (`Chamber Committee on Body` → rewrites to canonical form). Without this the OpenStates-sourced majority of bills couldn't be parsed. 7 new tests. Backfill script `scripts/backfill-bill-committees.mjs`. | parser + backfill |
| #232 | OpenStates daily sync writes `current_committee_name` on every bill refresh. Daily cron `backfill-bill-committees` job as safety net. | sync + cron |
| #233 | `/bills?filter=in-my-committees` pre-filtered browse view with banner + escape link | `/bills` |
| #234 | `/status` surfaces committee-leverage windows count (public proof-of-life metric) | `/status` |
| #236 | `⚡ Your rep decides` chip in `AlertCard` meta row on `/pulse` | `/pulse` |
| #237 | "Currently deciding" section on legislator detail — shows every active bill in committees they sit on | `/legislators/[id]` |
| #238 | Mounts `YourRepDecidingThisBill` callout on `/alerts/[id]` — surfaces leverage on the first-touchpoint surface (push-notification destination) | `/alerts/[id]` |

**5 user-facing surfaces now carry the committee-urgency signal:**
1. `/bills/[id]` — full callout when viewing a bill page
2. `/dashboard` — `MyCommitteeBillsWidget` listing all your leverage bills
3. `/pulse` — chip on alert cards in the feed
4. `/alerts/[id]` — full callout on alert detail
5. `/legislators/[id]` — "Currently deciding" section showing bills the legislator has direct power over

Plus 2 supporting surfaces:
- `/bills?filter=in-my-committees` — pre-filtered browse for signed-in users
- `/legislators/committee?name=X` — chair-first member roster lookup
- `/status` — public stat counting all open leverage windows

**Coverage as of merge:** 30 of 467 active bills have `current_committee_name` populated. Breakdown: NJ:20, TN:3, WA:3, AL:3, CO:1. The remaining 437 either don't mention a committee in their `last_action` text or use ambiguous phrasing ("Died In Committee" / "Re-referred to Rules Committee"). OpenStates daily sync now writes the column on every refresh, so coverage grows organically as bills move.

**Next compounds to consider (still open):**
- State-legislature hearing alerts (no data source yet; LegiScan/OpenStates have calendar APIs — separate effort)
- Push notification when a battleground-committee bill changes state
- Server-side PostHog capture for funnel analytics (currently `posthog-js` only captures client-side; bots don't fire events). Needs explicit go from owner before shipping.
- `/leverage` cross-cutting hub page that combines committee bills + upcoming deadlines + active campaigns into a single "what should I do RIGHT NOW" view.

## Audit highlights

**Strengths**
- Codebase has **no `TODO`/`FIXME`/`HACK` debt** in `src/` — feature flags are intentional.
- All admin pages reachable from `/admin`. No orphan routes.
- Bill + news + forum titles already use shared normalization (`displayTitle()`).
- Cron pipeline fully wired (Vercel daily + GH Actions hourly + GH Actions daily-deeper).
- Security posture documented + hardened across PRs #118-#127.
- BoP pipeline end-to-end (scrape → PDF → AI classify → auto-emit-on-confident).
- Invite friends v2 with attribution funnel + 11 share platforms.
- PWA manifest installable; APP_STORE_READINESS.md documents both store paths.

**Gaps surfaced by the audit**
| Surface | Problem | Severity |
|---|---|---|
| `/admin` | 26 cards in flat grid; queue cards (7 of them carry numeric backlog) scattered among static config | P0 |
| `/admin` | `Emergency mode` at slot 26 (bottom). Should be unmissable | P0 |
| `/leader` | 7 of 8 grid cards are "coming soon" stubs that drown the 1 shipped tool | P1 |
| `/dashboard` | `active_campaigns` at slot 7 (too low). `profile_completion` mid-stack instead of top-when-firing | P0 |
| `/dashboard` | Bottom 8-card chrome grid duplicates the global nav | P2 |
| `/account` | 17 sections in one scroll. Notifications fragmented across 5 unrelated sections | P0 |
| `/account` | `My templates` links to `/dashboard/templates` (outside `/account` tree, no breadcrumb back) | P1 |
| `/admin/announcements` | No "Add new" CTA visible despite being admin-creatable | P1 |
| `/alerts/submit` | Form submits but no next-step CTA — dead-end | P1 |
| no `/submit` hub | No single discoverable surface for "submit something" — users have to know each form's URL | P1 |
| Campaign titles | Auto-generated use `"Stop [STATE] [BILL]: ..."` but manual campaigns have no enforced format; no visual auto-vs-manual indicator in the list | P2 |
| `package.json` | `sync:capitals` script orphaned (never called by any cron) | P3 |

## Prioritized work plan

### P0 — ✅ Shipped (PR #137)
1. ~~**Admin dashboard reorg**~~ — priority bands live (queue inbox auto-floats, emergency-mode pinned right, P1/P2/P3 sections)
2. ~~**User dashboard reorder**~~ — `DEFAULT_WIDGETS` reorganized into P0 blockers / P1 radar / P2 identity
3. ~~**/account sidebar nav**~~ — 7-section sticky-sidebar layout (Identity / Security / Notifications / Integrations / Advocacy / Growth / Data)
4. ~~**`/submit` hub page**~~ — `/submit` lists every intake form, filtered by role

### P1 — High value
5. ~~**Leader dashboard collapse**~~ — shipped in PR #137
6. ~~**Missing "Add" CTAs**~~ — `/admin/announcements` has explicit "+ New announcement" toggle; `/admin/discord-integrations` verified
7. ~~**/alerts/submit success CTA**~~ — submit redirects to `/pulse?tip_submitted=1` (good enough; a banner there could come later)
8. ~~**Campaign title normalization**~~ — shipped PR #221: `🤖 auto` / `👤 manual` badges on `/admin/campaigns` list
9. ~~**Cockpit tour move**~~ — shipped PR #221: `ReplayTourButton` now sits next to `CockpitCustomizer` in the dashboard header

### P2 — Polish
10. ~~**Municipal bill locality prefix**~~ — already handled via `scope`/`locality` chips.
11. ~~**`/dashboard/templates` re-host**~~ — moved to `/account/templates` (PR #222); legacy URL permanent-redirects.
12. ~~**News title cleanup migration**~~ — PR #229: migration 0124 strips TV-callsign suffixes (`KTVB`, `WCYB`, etc.) that 0105 missed; sync-news-rss script updated to prevent recurrence.

### P3 — Cleanup
13. ~~**`sync:capitals`**~~ — removed from `package.json`; script moved to `scripts/.archive/` (PR #222)
14. **Dead-CSS / unused tailwind classes** — sweep after the UI moves above settle (still pending; speculative without observed metrics)

### Out of scope / intentional
- Medical recruitment feature (`siteConfig.features.medicalRecruitment: false` — v2)
- AI personalization (`aiPersonalization: false` — v2)
- BoP per-state custom adapters (current Playwright + generic_html covers 47/51, the 4 remaining are stubborn JA3 TLS — defer until signal warrants headless-browser-per-state work)
- AI-assisted owner editor (user shelved earlier)

### User-side waiting list (no code action needed)
- R2 bucket creds → activate in-app video uploads
- LEGISCAN_API_KEY → Layer 2 of bill sync
- OPENFEC_API_KEY → mirror to Vercel
- Home page A/B/C pick (`/home-a` vs `/home-b` vs `/home-c`)
- ~7 BoP source URLs still erroring after the URL-fix migration; verify on `/admin/bop-monitor`
- Repo setting: **enable auto-merge** at `github.com/<owner>/<repo>/settings → General → "Allow auto-merge"` so future PRs don't require manual `gh pr merge`

## MCP / tool recommendations

Auto mode currently uses: Supabase, Gmail, Notion, Chrome, scheduled-tasks, ccd-session/directory, mcp-registry, Claude_Preview.

**Just added (2026-05-13):**
- **Vercel MCP** — `https://mcp.vercel.com` (HTTP, OAuth). Awaiting first-use OAuth handshake.
- **PostHog MCP** — `https://mcp.posthog.com/mcp` (HTTP, OAuth). Awaiting first-use OAuth handshake.

**Investigated, skipped:**
- **GitHub MCP** — both the Copilot-hosted endpoint and the open-source stdio variant failed (paid Copilot dep + sandbox blocked PAT-in-env install). `gh` CLI already handles 95% of what we'd use the MCP for; skip.
- **MCP Market** (https://app.mcpmarket.com) — registry/marketplace of MCP servers. Adds zero capability over `claude mcp add` direct-attach and creates a credentials surface area we'd have to trust. Keep the account for browsing only.

**Still worth considering:**
| Tool | Why | Effort |
|---|---|---|
| **Sentry MCP** | Browse production errors. `@sentry/nextjs` wired in. Defer until error volume signals it. | 1 line + API key |
| **Linear MCP** | Persist todo list across sessions (would replace in-session-only todos). Single-owner, lower priority. | 1 line |
| **Browserbase / Browser-use** | Managed headless-browser. Could replace Playwright in GH Actions for the 4 TLS-blocked BoP states. | Signup + 1 line |

For "Hermes or another free working agent": closest fits for our shape are workflow orchestrators, not additional LLMs. **n8n** (self-hosted) or **Inngest** (cloud free tier) would let us declare durable workflows (retry, fan-out, scheduling) without building it custom. Not urgent — current cron + GH Actions stack does this fine.

## Memory enrichment — what next sessions should know

When the next Claude session opens, the priority context is:

1. **The site is feature-rich and shipping daily.** Don't re-explore from scratch — read `AGENTS.md`, `ARCHITECTURE.md`, this `ROADMAP.md`, and `SECURITY.md` for context.
2. **Auto-merge is disabled at repo settings** — every PR requires `gh pr merge <n> --squash` manually. Owner can enable in repo settings.
3. **The BoP pipeline is the highest-leverage feature.** It's the early-warning system. Keep its data quality high.
4. **The campaign queue has ~1100 pending after the dedup pass.** Use `/admin/campaigns/pending` filters before approving.
5. **The owner is a non-developer** — proposals should include rationale and tradeoffs, not just diffs.
6. **Hard rules** (from `CLAUDE.md`): nonpartisan, one-click standard, free-tier only for v1, real data only.

This doc is the entry point for "where are we?". Update it when priorities shift.
