# iKratom — Audit + Roadmap

_Living doc. Updated 2026-05-13 — P0 + most P1 items have shipped (PRs #137, #217–#220, #221) + committee-urgency trilogy (#223–#225)._
_See `SECURITY.md` for the security side, `APP_STORE_READINESS.md` for store path._

## Committee-urgency feature (shipped 2026-05-13)

The mission lever the platform's whole shape exists for: when a bill sits in committee, only the ~10-20 legislators on that committee can vote it out. Of those, only their constituents have leverage. Lobbyists target precisely; advocates almost never do.

Three PRs shipped this set:

| PR | What | Where |
|---|---|---|
| #223 | "YOUR rep is deciding this bill" callout when signed-in user's rep is on the bill's current committee. Migration `0123_bill_current_committee.sql` adds `bills.current_committee_name` + chamber + updated_at + inline backfill from `bill_actions`. New `src/lib/bill-committee.ts` parser. | `/bills/[id]` |
| #224 | Wires the same regex into the hourly LegiScan sync so `current_committee_name` stays fresh as bills move through committees | `scripts/sync-bills-via-legiscan.mjs` |
| #225 | `/legislators/committee?name=X` chair-first member roster — backs the no-match fallback link from #223 | New route |

**Pending:** `npm run db:push` to apply migration 0123 in production. UI degrades gracefully (renders nothing) until then.

**Next compounds to consider:**
- State-legislature hearing alerts (no data source yet; LegiScan/OpenStates have calendar APIs — separate effort)
- `/bills?filter=committees-with-my-rep` pre-filtered view
- Wire `is_kratom_relevant` flag from `legislator_committees` to boost certain committees in the urgency callout's color/copy

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
10. ~~**Municipal bill locality prefix**~~ — already handled the better way: `BillsBrowser` + `/bills/[id]` both render structured `scope` (purple chip) + `locality` (📍 chip) above the title via `bill.scope` + `bill.locality` columns. Title prepending unnecessary.
11. ~~**`/dashboard/templates` re-host**~~ — moved to `/account/templates` (PR #222); legacy URL permanent-redirects.
12. **News title cleanup migration** — verify no `" - WSMV"`-style suffixes still in DB; one-shot strip if found

### P3 — Cleanup
13. ~~**`sync:capitals`**~~ — removed from `package.json`; script moved to `scripts/.archive/` (PR #222)
14. **Dead-CSS / unused tailwind classes** — sweep after the UI moves above settle

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
