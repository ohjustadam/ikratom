# iKratom — Audit + Roadmap

_Living doc. Updated 2026-05-12 after the cross-cutting IA audit._
_See `SECURITY.md` for the security side, `APP_STORE_READINESS.md` for store path._

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

### P0 — Ship now (highest user-visible impact)
1. **Admin dashboard reorg** — priority bands: P0=needs-me-now (queue cards float to top, emergency-mode pinned right) / P1=daily ops / P2=observability collapsible / P3=static catalogs collapsible
2. **User dashboard reorder** — update `DEFAULT_WIDGETS` order in `src/modules/dashboard/widgets/types.ts`: blockers+actions first, personal radar mid, identity+growth bottom
3. **/account sidebar nav** — convert from one-scroll to layout-with-sidebar. 6 groups: Identity / Security & privacy / Notifications / Integrations / Advocacy tools / Recognition & growth
4. **`/submit` hub page** — central directory of every "create new X" route + each routes has discoverable "Add new" CTA on its list page

### P1 — High value next
5. **Leader dashboard collapse** — bury 7 stubs under one "Coming soon for leaders" accordion. Hero the 1 live tool (Field signup) + the 2 cross-links (`/admin/campaigns`, `/admin/locals`).
6. **Missing "Add" CTAs** — `/admin/announcements`, `/admin/discord-integrations` (verify)
7. **/alerts/submit success CTA** — after submit, show "Thanks. Track other alerts on /pulse →" + "Submit another →"
8. **Campaign title normalization** — list-page badge `🤖 auto` vs `👤 manual`; for manual create form, suggest `"Take action: [state] [title]"` format
9. **Cockpit tour move** — `ReplayTourButton` out of `/account`, into the dashboard header next to `CockpitCustomizer`

### P2 — Polish
10. **Municipal bill locality prefix** — when `bill.source_url` matches `city/` or `county/`, prepend "Marshall, IL — " to display title
11. **`/dashboard/templates` re-host** — move to `/account/templates` so links stay inside `/account/*` tree
12. **News title cleanup migration** — verify no `" - WSMV"`-style suffixes still in DB; one-shot strip if found

### P3 — Cleanup
13. **`sync:capitals`** — remove from `package.json` or move to `scripts/.archive/`
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

Auto mode + Claude Desktop currently uses: Supabase, Gmail, Notion, Chrome, scheduled-tasks, ccd-session/directory, mcp-registry, Claude_Preview.

Adding these would unlock concrete leverage:

| Tool | Why | Effort to add |
|---|---|---|
| **GitHub MCP** | Batch-create issues, manage PRs, view CI logs without `gh` round-trips. PR auto-merge programmatic toggle. | 1 conf line |
| **Sentry MCP** | Browse real production errors. `@sentry/nextjs` is already wired into the app — currently I have no visibility into what users actually hit. | 1 conf line + Sentry API key |
| **Linear MCP** (or **Notion** more deeply) | Persist this todo list across sessions. The in-session todo evaporates between chats. | 1 conf line |
| **PostHog MCP** | We already ship PostHog client + server SDKs. Seeing real feature-usage metrics would inform priorities (e.g. is `/forum` actually used? is the cockpit tour completed?) | 1 conf line + PostHog token |
| **Browserbase / Browser-use** | Managed headless-browser as a service. Could replace Playwright in GH Actions for the 4 TLS-blocked BoP states. Free tier exists. | Service signup + 1 config |

For "Hermes or another free working agent": the closest fits for ikratom's existing infrastructure shape are workflow orchestrators rather than additional LLMs. **n8n** (self-hosted, fully free) or **Inngest** (cloud, generous free tier) would let us declare durable workflows (retry, fan-out, scheduling) without building it custom. Not urgent — current cron + GH Actions stack does this fine — but worth knowing when the orchestration grows.

## Memory enrichment — what next sessions should know

When the next Claude session opens, the priority context is:

1. **The site is feature-rich and shipping daily.** Don't re-explore from scratch — read `AGENTS.md`, `ARCHITECTURE.md`, this `ROADMAP.md`, and `SECURITY.md` for context.
2. **Auto-merge is disabled at repo settings** — every PR requires `gh pr merge <n> --squash` manually. Owner can enable in repo settings.
3. **The BoP pipeline is the highest-leverage feature.** It's the early-warning system. Keep its data quality high.
4. **The campaign queue has ~1100 pending after the dedup pass.** Use `/admin/campaigns/pending` filters before approving.
5. **The owner is a non-developer** — proposals should include rationale and tradeoffs, not just diffs.
6. **Hard rules** (from `CLAUDE.md`): nonpartisan, one-click standard, free-tier only for v1, real data only.

This doc is the entry point for "where are we?". Update it when priorities shift.
