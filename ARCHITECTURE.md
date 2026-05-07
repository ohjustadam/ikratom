# Architecture

High-altitude map of iKratom. For first-read context see `AGENTS.md`. For terminology see `docs/GLOSSARY.md`. For schema specifics see `docs/SCHEMA.md` (auto-generated).

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
        ┌──────── Vercel ──────────┐         ┌─────────── Supabase ───────────┐
        │                           │         │                                  │
        │ Next.js 16 (App Router)   │         │  Postgres (RLS)                  │
        │  · proxy.ts (req hooks)   │   ─────▶│  Auth (email + TOTP)             │
        │  · API routes             │         │  Realtime (postgres_changes,     │
        │  · Cron (daily only)      │         │            presence, broadcast)  │
        │                           │   ◀───  │  Storage (avatars, attachments)  │
        └───────┬───────────────────┘         └────────────┬─────────────────────┘
                │                                            │
                │ /api/cron/fire-waves (hourly)              │
                │                                            │
        ┌───────▼─────────────┐         ┌──────────────────▼──────────────────┐
        │ GitHub Actions cron │         │ Local dev workstation (owner's)     │
        │ (sub-daily jobs)    │         │  · Ollama (translation, enrichment)  │
        └─────────────────────┘         │  · npm scripts (manual sync, etc.)   │
                                         └──────────────────────────────────────┘
```

Outbound to Gemini Flash 2.5 (free tier) for grounded research happens from **scripts** (sync-state-capitals, etc.), not from the live app. Production paths only call services we control + Supabase.

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
│   └── VENDOR_ACCOUNTS.md     # Vendor design (Option A chosen)
├── public/
│   ├── sw.js                  # Service worker (offline + push)
│   ├── how-it-works/          # Annotated screenshots
│   └── ...                    # icons, manifests
├── src/
│   ├── proxy.ts               # ⚠️  Next.js 16 replacement for middleware.ts
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
│       └── cron-hourly.yml    # Hourly cron (Vercel Hobby blocks sub-daily)
└── vercel.json                # Daily-only cron schedule
```

---

## Module map (`src/modules/`)

| Module | Owns | Public surface |
|---|---|---|
| **auth** | login/signup, profile, MFA, password reset, sessions, push subscribe, OAuth (Gmail) | `actions.ts`, `actions-mfa.ts`, `actions-push.ts`, `actions-password.ts`, etc. |
| **admin** | Admin/owner/leader context guards, lounge moderation, emergency mode | `actions.ts` (guards), `lounge-actions.ts`, `campaign-review-actions.ts` |
| **campaigns** | Action templates, sends, scope matching, auto-create | `actions.ts`, `auto-create.ts` |
| **waves** | Scheduled batch sends (Gmail-based), reminders | `fire.ts`, `reminders.ts` |
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
2. **`proxy.ts`** preprocesses:
   - UA blocklist (returns 403 if AI crawler)
   - Embed referral cookie capture
   - Landing-state cookie capture
   - Supabase auth cookie refresh
   - Protected-route gate (redirects to `/login` if needed)
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
| Daily 12:00 UTC | `/api/cron/daily-sync` | Vercel cron | Bills sync, news sync, dedupes, auto-create campaigns |
| Hourly | `/api/cron/fire-waves` | GitHub Actions (`.github/workflows/cron-hourly.yml`) | Fire scheduled waves, send 1h reminders, push fan-out |

Both routes auth via `Authorization: Bearer ${CRON_SECRET}`. Service-role Supabase client used internally to bypass RLS.

**Why GitHub Actions for hourly:** Vercel Hobby plan only allows daily crons. See `docs/DECISIONS.md`.

---

## External integrations

| Service | Use | Auth | Free tier |
|---|---|---|---|
| Supabase | DB + Auth + Realtime + Storage | API keys | Yes (with limits) |
| Vercel | Hosting + daily cron | Account | Hobby |
| GitHub | Repo + Actions hourly cron | PAT / repo secrets | Yes |
| Gemini API | Grounded research (scripts only) | API key | 1500/day Flash 2.5 |
| Ollama | Local AI (translation, enrichment) | None — local | ∞ |
| Web Push (FCM/APNs/Mozilla) | Push notifications | VAPID keypair | Yes |
| Google OAuth (Gmail) | Wave email sending | OAuth | Yes |
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
- Bot/UA blocklist in `proxy.ts`
- AI-crawler robots.txt + noai meta tags + no source maps in build
- E2E encryption on DMs (libsodium, key in browser only)
- Push secret + VAPID private key gitignored, server-side only
- HTTPS enforced (Vercel default)

See `docs/DECISIONS.md` for tradeoffs.

---

## Deployment

- `git push origin main` → Vercel auto-deploy
- Migrations: `npm run db:push` (Supabase Management API)
- Schema dump: `npm run docs:schema`
- Hourly cron: any commit to main triggers GitHub Actions to start using new code on the next hour boundary

---

## Where to look for...

| For... | Look in... |
|---|---|
| Latest schema | `docs/SCHEMA.md` (auto-generated) |
| Why we did X | `docs/DECISIONS.md` |
| How to do X | `docs/TASK_PATTERNS.md` |
| What X means | `docs/GLOSSARY.md` |
| AI provider routing | `docs/AI_TOOLKIT.md` |
| Vendor accounts design | `docs/VENDOR_ACCOUNTS.md` |
| Common gotchas | `AGENTS.md` § Common pitfalls |
