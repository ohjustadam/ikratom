# AGENTS.md — first read for any AI assistant

You are working on **iKratom**, a nonpartisan kratom advocacy platform. This file is the cold-start brief: read it once and you have enough context to be useful without wasting tokens grepping.

**Sister docs (read on demand):**
- `CLAUDE.md` — product rules, scope, conventions (this file extends it)
- `ARCHITECTURE.md` — directory + module map, data flow
- `docs/GLOSSARY.md` — domain terms (KCPA, GKC, AKA, scope, wave, etc.)
- `docs/DECISIONS.md` — non-obvious tradeoffs we've already debated; don't relitigate
- `docs/SCHEMA.md` — auto-generated table/column/RLS/RPC dump (regenerate with `npm run docs:schema`)
- `docs/TASK_PATTERNS.md` — recipes (how to add a migration, admin page, server action, etc.)
- `docs/AI_TOOLKIT.md` — provider routing rules + when to use Claude vs Gemini vs Ollama vs Groq

---

## What this product is

A nonpartisan civic-action toolbelt for the kratom advocacy community. The mission: turn hours of advocacy work — sending legislator emails, tracking bills, finding contacts — into a few minutes a day. Independent of any org (AKA, GKC, BAE, MAC).

**Hard product rules** (do not cross):
- Nonpartisan. Never lean toward an org or political side.
- Empower the advocate, not the org.
- One-click is the standard. >2 clicks for any action = broken.
- Free-tier only for v1. mailto: not Resend. No paid APIs.
- Real data only. Bill status, legislator info, news must be scraped/synced — never manually curated past initial seed.
- Recruitment angle: shop owners + medical pros are first-class users.

**You are not the product owner.** The owner (single person, non-developer) sets direction. Your job is to be skilled hands. Surface tradeoffs, propose options, ship cleanly.

---

## Stack

| Layer | Tech | Notes |
|---|---|---|
| Framework | Next.js **16** (App Router) | `proxy.ts` not `middleware.ts`. `cookies()`/`headers()` are async. **Read `node_modules/next/dist/docs/` before using unfamiliar APIs.** |
| Language | TypeScript (strict) | |
| Styling | Tailwind v4 | No custom CSS unless absolutely needed |
| DB | Supabase Postgres + Auth + RLS + Realtime + Storage | Service-role client for cron jobs only |
| AI | Local Ollama (default), Gemini Flash 2.5 (grounding), Groq (speed fallback) | See `docs/AI_TOOLKIT.md` for routing |
| Cron | Vercel daily + GitHub Actions hourly | Vercel Hobby plan blocks subdaily — hourly cron lives in `.github/workflows/cron-hourly.yml` |
| Hosting | Vercel | Hobby plan, daily cron only, see GitHub Actions workflow |
| Auth | Supabase Auth (email/password + TOTP MFA) | E2E DM encryption via libsodium |
| PDFs | pdf-parse v2 (CJS bridge via `createRequire`) | Class-based API: `new PDFParse(buf)` |

---

## Roles

- **Owner** — `profiles.is_owner = true`. One person. Ultimate privilege. Currently `ohjustadam@proton.me`.
- **Admin** — `profiles.is_admin = true`. Moderation, sync, user management. Promoted by owner.
- **Advocate Leader** — `profiles.is_advocate_leader = true`. Can author campaigns. Lower than admin.
- **User** — default. Public-data read, own profile, take campaign actions.

Server-side checks: `getAdminContext()`, `getCreatorContext()` in `src/modules/admin/actions.ts`. RLS uses `is_admin(uid)` SQL function. **Never trust client-side admin flags.**

---

## Directory map (compressed)

```
src/
  app/             # Next.js routes (server components by default)
    admin/         # Owner/admin tools (forum, lounge, partners, users, etc.)
    forum/         # Community page (Lounge chat at top, state forums below)
    campaigns/     # Action UI
    bills/         # Bill detail pages with translations
    api/cron/      # Cron endpoints (auth via Bearer CRON_SECRET)
    auth/callback/ # Supabase auth callback
  modules/         # Feature modules
    auth/          # Login/signup, MFA, password, push, sessions, gmail
    admin/         # Admin context guards + lounge moderation
    campaigns/     # Action templates, sends, auto-create
    chat/          # Lounge realtime chat
    forum/         # Threads, posts, reactions, moderation
    notifications/ # Prefs + push fan-out
    partners/      # Partner shop CRUD + QR kit
    waves/         # Scheduled email batches (Gmail-based)
    dm/            # E2E encrypted direct messages
  lib/
    supabase/      # server / client / service-role factories
    audit.ts       # recordAdminAction(...)
    rate-limit.ts  # Postgres-backed atomic rate limit
    push/          # Web push sender (web-push lib)
    ai/            # Router + provider wrappers (when present)
  components/      # Shared UI
  i18n/            # Locale files (en, id, th, ms, vi, tl)
supabase/
  migrations/      # Numbered SQL migrations, auto-applied via npm run db:push
scripts/           # Maintenance scripts (sync, enrich, translate, etc.)
```

---

## Conventions

- **Server components by default.** Add `"use client"` only for interactivity.
- **Components ≤ ~100 lines.** Split if larger.
- **Money/dates:** `timestamptz` in DB, ISO strings in TS, `toLocaleString()` for display.
- **All tables flat.** No nested JSON if you can avoid it. CSV-exportable.
- **Email templates** use `{{variable}}` placeholders, rendered server-side before mailto: link.
- **Migration naming:** `0NNN_short_topic.sql`. Top-of-file comment explains intent + rollback.
- **Server actions** are typed and live in `src/modules/<module>/actions.ts`. Always re-check auth/role server-side.
- **Audit log:** any admin mutation calls `recordAdminAction({...})`.

---

## Where to grep first

| Looking for... | Grep target |
|---|---|
| RLS policy on table X | `supabase/migrations/` for `policy.*table_name` |
| Admin auth check | `src/modules/admin/actions.ts` |
| Campaign send flow | `src/modules/campaigns/` + `src/modules/waves/fire.ts` |
| Bill enrichment | `scripts/enrich-bills*.mjs` + `supabase/migrations/0030_deep_bill_analysis.sql` |
| Realtime patterns | `src/modules/chat/Lounge.tsx`, `src/app/forum/[state]/[thread]/ThreadView.tsx` |
| Push notifications | `src/lib/push/send.ts`, `src/modules/notifications/push-fanout.ts`, `public/sw.js` |
| Cron entry point | `src/app/api/cron/fire-waves/route.ts` (hourly) + `daily-sync/route.ts` (daily) |
| Translation cache | `src/lib/translations.ts` + `scripts/translate-content.mjs` |

---

## Common pitfalls (do not repeat)

1. **Realtime + RLS:** if a table's SELECT policy is `to authenticated`, the realtime WebSocket needs the JWT — call `supabase.realtime.setAuth(session.access_token)` before subscribing. Tables with `to public` SELECT work without it.
2. **Realtime DELETE filtering:** if your channel filter is on a non-PK column, the table needs `REPLICA IDENTITY FULL`. Default identity logs only the PK on delete, so the filter can't match and the event is silently dropped.
3. **`e.currentTarget` in async transitions:** capture the element synchronously before `startTransition` — React nullifies `currentTarget` after the handler returns.
4. **Profile reads:** profiles SELECT RLS only allows admin or self. To read other users' public fields, call the `get_public_profile(uuid)` or `get_public_profiles(uuid[])` SECURITY DEFINER RPC.
5. **Vercel Hobby cron:** only daily intervals allowed. Sub-daily jobs go in `.github/workflows/cron-hourly.yml`.
6. **pdf-parse v2:** ESM-incompatible. Use `createRequire(import.meta.url)('pdf-parse')` then `new PDFParse(buf)`.
7. **Service worker push:** payloads with a `tag` field deduplicate at the OS level. Use `tag` for replaceable notifications, omit for stacking.
8. **Slug fields are immutable in production.** Once a partner / campaign slug is printed in the wild (QR codes, share links), changing it breaks every existing link.

---

## What "done" looks like for a feature

- Server-side auth/role checked
- RLS policy exists for any new table
- Audit log call for any admin mutation
- Rate-limit on any user-driven write
- Server-side input validation (regex for IDs, length caps for text)
- TypeScript strict, build passes
- PR description includes a manual test plan

---

## How to ask the human owner

The owner is non-developer. When you need a decision:
- Frame as **"X or Y?"** with a 1-line rec, not as open-ended advice
- Never ask permission for routine choices — make them and note the call in `DECISIONS.md`
- Token-efficient: don't re-explore files you've already read this session

The owner has explicitly said: don't re-grep the codebase for context you can already infer; use partial reads with offset/limit when you need fragments.

---

## Source-of-truth rule: always cross-reference `.env.local`

**Before assuming any project context — Supabase project, app URL, push keys, OAuth client ids — open `.env.local` and read what's actually configured.**

Specific failure modes this prevents:
- **Supabase MCP project mismatch.** The MCP server you're given may be connected to a *different* Supabase project than this repo's. Verify `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_PROJECT_REF` in `.env.local` against `mcp__supabase__get_project_url`. If they don't match, MCP SQL/migrations/logs are pointing at the wrong DB — fall back to `npm run db:push` and `node --env-file=.env.local scripts/*.mjs` which always read this repo's env.
- **APP_URL drift.** Local dev is `http://localhost:3001`. Prod is `https://www.ikratom.org`. When generating links/curls/cron-call examples, pull the right one from `.env.local` (local) or know it's overridden by Vercel env in production.
- **VAPID + OAuth client IDs.** Don't assume — read.

When `.env.local` and Vercel disagree on a value (and they sometimes will, e.g. APP_URL), say so explicitly in the response and pick the correct one for the context. Never guess.

---

## Working partnership

The owner's framing: *"You're the brain partner, hands and fingers, and memory. I'm the visionary architect."* What that means in practice:

- **Lean hard on capability.** Use `gh`, Bash, the Chrome browser extension MCP (drive Vercel/Resend/Discord/Stripe portals), the Supabase MCP (when project ref matches — see above), and full file-system access. Don't punt to the owner for things you can do directly.
- **Only ask for things you genuinely can't do.** Pasting secret values from places I can't reach (e.g. a Vercel reveal that would echo into chat) is for the owner. Picking which design direction to take is for the owner. Almost everything else, do it.
- **One round-trip > five.** Batch tool calls (`browser_batch`, parallel Bash, parallel Agents).
- **Save state in code, not chat.** Anything reusable becomes a script in `scripts/`, an admin server action, a migration, or a doc — not a one-off chat instruction the owner has to recall.
