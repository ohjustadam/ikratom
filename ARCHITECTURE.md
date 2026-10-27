# Architecture

High-altitude map of iKratom. _Hosting and cron corrected 2026-10-17: Netlify, GitHub Actions, proxy disabled. For what is true right now, `STATE_OF_PLAY.md` wins._ For first-read context see `AGENTS.md`. For terminology see `docs/GLOSSARY.md`. For schema specifics see `docs/SCHEMA.md` (auto-generated).

---

## 1-screen mental model

```
                ┌────────────── Browser ──────────────┐
                │                                       │
                │  Pages (Server Components)            │
                │  Client islands ("use client")        │
                │  Service worker (push, offline)       │
                └───────────────┬─────────────────────┬─┘
                                │ HTTP                │ WebSocket (Realtime)
                                ▼                      ▼
        ┌─ Netlify (via Cloudflare) ┐        ┌─────────── Supabase ───────────┐
        │                           │         │                                  │
        │ Next.js 16 (App Router)   │         │  Postgres (RLS)                  │
        │  · proxy DISABLED         │   ─────▶│  Auth (email + TOTP)             │
        │  · API routes             │         │  Realtime (postgres_changes,     │
        │  · /api/cron/* endpoints  │         │            presence, broadcast)  │
        │                           │   ◀───  │  Storage (avatars, attachments)  │
        └───────┬───────────────────┘         └────────────┬─────────────────────┘
                │                                            │
                │ /api/cron/* (called by GitHub Actions)     │
                │                                            │
        ┌───────▼─────────────┐         ┌──────────────────▼──────────────────┐
        │ GitHub Actions cron │  ← dispatched on time by Supabase pg_cron         │ Local dev workstation (owner's)     │
        │ (all scheduled jobs)│         │  · Ollama (translation, enrichment)  │
        └─────────────────────┘         │  · npm scripts (manual sync, etc.)   │
                                         └──────────────────────────────────────┘
```

Outbound calls to the free AI pool (Groq, Gemini, Mistral, NVIDIA, Cloudflare, OpenRouter free models) mostly happen from **scripts** on GitHub Actions, not from the live app. The few request-time AI features (the AI Editor, letter personalize and compose, moderation) go through `src/lib/ai/` with their own keys in Netlify. Production paths otherwise call only services we control + Supabase.

---

## Directory map

```
ikratom/
├── AGENTS.md                  # First-read for any AI session
├── ARCHITECTURE.md            # This file
├── CLAUDE.md                  # Product rules + scope
├── docs/
│   ├── SCHEMA.md              # Auto-generated table/RLS/RPC dump
│   ├── GLOSSARY.md            # Domain + tech terms
│   ├── DECISIONS.md           # Tradeoff log
│   ├── TASK_PATTERNS.md       # Recipes
│   ├── AI_TOOLKIT.md          # Provider routing playbook
│   ├── AI_PROVIDERS.md        # Every free AI key: what it is, where it is set
│   └── RUNBOOK_*.md           # Owner ops and review-queue runbooks
├── public/
│   ├── sw.js                  # Service worker (offline + push)
│   ├── how-it-works/          # Annotated screenshots
│   └── ...                    # icons, manifests
├── src/
│   ├── proxy.disabled.ts      # Disabled 2026-07-26 (Netlify adapter can't bundle Next 16 middleware)
│   ├── app/                   # Routes (server components by default)
│   ├── modules/               # Feature modules — see "Module map" below
│   ├── lib/                   # Cross-cutting helpers
│   │   ├── supabase/          # server / client / service factories
│   │   ├── audit.ts           # recordAdminAction()
│   │   ├── rate-limit.ts      # Postgres-backed rate limit RPC
│   │   ├── push/              # web-push wrapper
│   │   ├── translations.ts    # Translation cache reader
│   │   └── ai/                # (when present) Provider router + wrappers
│   ├── components/            # Shared UI components
│   ├── i18n/                  # Locale message files (en/id/th/ms/vi/tl)
│   └── types/                 # Shared TS types
├── supabase/
│   └── migrations/            # 0NNN_topic.sql files (apply via db:push)
├── scripts/                   # Maintenance: sync, enrich, translate, dump-schema, etc.
├── .github/
│   └── workflows/
│       └── cron-*.yml         # Every scheduled job (hourly, daily, weekly, nightly)
├── netlify.toml               # Hosting, build, and the build-skip `ignore` rule
└── vercel.json                # Vestigial: `crons` is []
```

---

## Module map (`src/modules/`)

| Module | Owns | Public surface |
|---|---|---|
| **auth** | login/signup, profile, MFA, password reset, sessions, push subscribe, OAuth (Gmail) | `actions.ts`, `actions-mfa.ts`, `actions-push.ts`, `actions-password.ts`, etc. |
| **admin** | Admin/owner/leader context guards, lounge moderation, emergency mode | `actions.ts` (guards), `lounge-actions.ts`, `campaign-review-actions.ts` |
| **campaigns** | Action templates, sends, scope matching, auto-create | `actions.ts`, `auto-create.ts` |
| **waves** | Scheduled batch sends (from the member's own connected mailbox), reminders | `fire.ts`, `reminders.ts` |
| **forum** | Threads, posts, reactions, moderation, reports | `actions.ts`, `types.ts` |
| **chat** | Lounge realtime room | `actions.ts`, `Lounge.tsx`, `RecentActivity.tsx` |
| **notifications** | In-app preferences, push fan-out | `actions.ts`, `push-fanout.ts` |
| **partners** | Partner shops, slug generation, QR rendering | `actions.ts`, `qr.ts` |
| **dm** | E2E encrypted direct messages, blocking | `actions.ts`, `block-actions.ts` |
| **bills** | Bill rendering, sponsors, deep analysis flags | (mostly route-level, plus enrichment scripts) |
| **library** | Resource library / docs hub | route-level |
| **stories** | Advocacy story submissions | `actions.ts`, moderation in `admin/` |
| **events** | Town halls, hearings | route-level |

---

## Data flow — typical request

1. Browser hits a Next.js route (e.g. `/forum`)
2. **No proxy runs** (`src/proxy.disabled.ts`). What it used to do now lives elsewhere: bot blocking is Cloudflare Bot Fight Mode; attribution capture is a client island plus `src/app/api/attribution/route.ts`; auth refresh and route gating happen in the server components. The account-lock redirect to `/locked` was not restored.
3. Server Component runs:
   - `createClient()` → Supabase server client (cookies → user session → RLS)
   - Database queries respect RLS
   - Result JSX returns
4. Stream to browser
5. Hydration: client islands (`"use client"`) attach
6. Client islands subscribe to Realtime channels for live data

For mutations: a Server Action (in `src/modules/<x>/actions.ts`) re-checks auth/role server-side, validates inputs, writes to Postgres (RLS enforces row-level), audit-logs if admin, returns `{ ok } | { error }`. Caller calls `router.refresh()` for SSR routes.

---

## Auth + RLS conventions

- Every table has RLS enabled.
- Policy naming: `<table>_<verb>_<scope>` — e.g. `chat_select_authenticated`, `partners_admin_all`.
- Common predicates use the `is_admin(uid)` SQL helper (lives in early migrations).
- For "public read of admin-private columns" → use a `<table>_public` view exposing only safe columns.
- For "narrow RLS bypass" (e.g. resolving names) → SECURITY DEFINER RPC like `get_public_profile(uuid)`.
- Server-side, every admin action also calls `getAdminContext()` (in addition to RLS) for defense in depth + audit logging.

See `docs/SCHEMA.md` for the full RLS matrix.

---

## Realtime model

| Channel | Used for | Notes |
|---|---|---|
| `thread:<id>` | Live forum replies | postgres_changes INSERT only |
| `dm:<conversation_id>` | Live DMs | postgres_changes INSERT, payload is ciphertext |
| `lounge:<room>` | Lounge chat | postgres_changes INSERT + DELETE + presence |
| `wave:<id>` | Wave fire status | postgres_changes INSERT + DELETE |

**Auth handoff:** if a table's SELECT RLS is `to authenticated`, the client must call `supabase.realtime.setAuth(token)` before subscribing. See `src/modules/chat/Lounge.tsx` for the canonical pattern.

**DELETE filtering:** if you filter on a non-PK column, the table needs `replica identity full`. Already done for `chat_messages`. See `docs/DECISIONS.md`.

---

## Cron architecture

| Schedule | Path | Triggered by | Job |
|---|---|---|---|
| Every 2h | `/api/cron/fire-waves` + scripts | `.github/workflows/cron-hourly.yml` | Fire scheduled waves, reminders, push fan-out, news intake/enrich |
| Daily | scripts + `/api/cron/reverify-local-officials` | `.github/workflows/cron-daily.yml` | Bills, legislators, news, dedupes, campaigns |
| Weekly / nightly | scripts | `cron-weekly.yml`, `cron-nightly-cloud.yml` and siblings | Committees, self-review (issue #929), digests |

Supabase `pg_cron` dispatches the hourly and daily workflows on time (migration 0263); their `schedule:` blocks are a deduped fallback.

Both routes auth via `Authorization: Bearer ${CRON_SECRET}`. Service-role Supabase client used internally to bypass RLS.

Every source is registered in `scripts/lib/cron-pager-registry.mjs`; the staleness pager alerts at 3× its interval.

---

## External integrations

| Service | Use | Auth | Free tier |
|---|---|---|---|
| Supabase | DB + Auth + Realtime + Storage | API keys | Yes (with limits) |
| Netlify | Hosting | Account | 1000 credits/month; `npm run credits` reads the real meter |
| Cloudflare | DNS, cache, Bot Fight Mode, R2 snapshots | Account | Yes |
| GitHub | Repo + every scheduled job | PAT / repo secrets | Yes |
| Groq, Gemini, Mistral, NVIDIA, Cloudflare Workers AI, OpenRouter | The free AI pool (scripts and a few site features) | API keys | Free tiers only; a provider that starts charging is dropped. Gemini needs a key from a Google project with no billing. See `docs/AI_PROVIDERS.md` |
| Ollama | Local AI (privacy-sensitive work, embeddings) | None — local | ∞ (owner's PC only) |
| Resend, Brevo | Platform mail: signup, resets, notices | API keys | Free tiers (Resend: 100/day) |
| Web Push (FCM/APNs/Mozilla) | Push notifications | VAPID keypair | Yes |
| Google OAuth (Gmail), Microsoft Graph (Outlook), SMTP app passwords (Yahoo/AOL/iCloud) | One-click letters and waves, sent from the member's own mailbox | OAuth / encrypted app password | Yes. Gmail needs Google verification beyond 100 test users |
| OpenStates | State legislator sync | API key | Yes |
| LegiScan | State bills sync | API key | 30k/month |
| US Census Geocoder | Address → district | None | Public |

No paid services in the production path. See `docs/AI_TOOLKIT.md` for AI provider strategy.

---

## State surfaces (where state lives)

- **Postgres** — primary source of truth for everything persistent
- **Supabase Storage** — avatars, story attachments, library uploads
- **Cookies** — auth session (Supabase-managed), embed referral, landing state, locale
- **localStorage** — DM private key (libsodium), unsent draft chat, UI prefs
- **Service worker cache** — static assets, offline page shell
- **VAPID-keyed push subscriptions** — `push_subscriptions` table
- **Client realtime state** — ephemeral; recovered from DB on reconnect

---

## Security posture (current)

- RLS on every table; admin guards on every server action
- TOTP MFA available; required for some admin operations (aal2 gate)
- Audit log table records every admin mutation
- Rate limits on user-driven writes (chat, forum posts, password change, etc.)
- Bot blocking at Cloudflare (Bot Fight Mode); the old `proxy.ts` UA blocklist is disabled
- AI-crawler robots.txt + noai meta tags + no source maps in build
- E2E encryption on DMs (libsodium, key in browser only)
- Push secret + VAPID private key gitignored, server-side only
- HTTPS enforced at Cloudflare and Netlify

See `docs/DECISIONS.md` for tradeoffs.

---

## Deployment

- A merge to `main` → Netlify production build (15 credits) unless the diff only touches build-ignored paths. Verify on a draft first: push `preview/<name>`
- Migrations: `npm run db:push` (Supabase Management API)
- Schema dump: `npm run docs:schema`
- Scheduled jobs: scripts run from the repo, so a merge to `main` is picked up by the next scheduled run, no deploy needed. Only `/api/cron/*` routes and anything else under `src/` need the Netlify build to go live.

---

## Where to look for...

| For... | Look in... |
|---|---|
| Latest schema | `docs/SCHEMA.md` (auto-generated) |
| Why we did X | `docs/DECISIONS.md` |
| How to do X | `docs/TASK_PATTERNS.md` |
| What X means | `docs/GLOSSARY.md` |
| AI provider routing | `docs/AI_TOOLKIT.md` |
| Common gotchas | `AGENTS.md` § Common pitfalls |
