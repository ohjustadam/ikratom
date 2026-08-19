# AGENTS.md — first read for any AI assistant

You are working on **iKratom**, a nonpartisan kratom advocacy platform. This file is the cold-start brief: read it once and you have enough context to be useful without wasting tokens grepping.

**START HERE if you're a new session:** read `private/V2_KICKOFF.md` — single source of truth for what's left before app-store submission and v2 work. It supersedes `ROADMAP.md` and anything below this line if there's a conflict.

**🏛️ If your task touches `/states`, `/briefings`, `/intel`, `/legislators`, or any state-scoped surface: ALSO read `private/STATE_HUB_SPEC.md` FIRST** — the canonical spec for the active State-HQ rebuild (owner ask 2026-06-22). It sets the consolidation IA (`/states/[code]` is the one hub), the 3-tier model, the live-data-not-baked rule, and the section-by-section build plan + fast-follow pipelines. Build to it; don't re-architect these pages ad hoc.

**Sister docs (read on demand):**
- `CLAUDE.md` — product rules, scope, conventions (this file extends it)
- `ARCHITECTURE.md` — directory + module map, data flow
- `docs/GLOSSARY.md` — domain terms (KCPA, GKC, AKA, scope, wave, etc.)
- `docs/DECISIONS.md` — non-obvious tradeoffs we've already debated; don't relitigate
- `docs/SCHEMA.md` — auto-generated table/column/RLS/RPC dump (regenerate with `npm run docs:schema`)
- `docs/TASK_PATTERNS.md` — recipes (how to add a migration, admin page, server action, etc.)
- `docs/AI_TOOLKIT.md` — provider routing rules + when to use Claude vs Gemini vs Ollama vs Groq
- `docs/RUNBOOK_owner_ops.md` — how the OWNER runs the platform with zero developer access (AI Editor-in-Chief, moderation hub, master-edit, self-healing). Keep it current when you change an admin surface.

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

- **Owner** — `profiles.is_owner = true`. Exactly one. Ultimate privilege. Identified by `OWNER_EMAIL` env var, not by a hard-coded value.
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

## Pre-commit verification — use `verify`, not `build`

For most code changes, use:

```bash
npm run verify          # typecheck + tests, ~9s   ← use this
npm run verify:full     # +eslint, ~25s
npm run build           # full Next.js build, ~33s  ← only when checking deploy-readiness
```

`verify` excludes `tests/rls.test.ts` because that test creates real Supabase users via service role — works in CI with a dedicated test project, fails locally because dev `.env.local` points at prod which rate-limits user creation. Run it explicitly when needed: `npx vitest run tests/rls.test.ts`.

Repo-level merge settings (post-PR #254):
- ✅ `delete_branch_on_merge` — merged branches auto-delete on GitHub
- ✅ `squash_merge_commit_title: PR_TITLE` — clean main history
- ✅ `squash_merge_commit_message: PR_BODY` — full context in commit log
- ✗ `allow_auto_merge` — gated by GitHub Pro for private repos; skipped on cost grounds. Continue using `gh pr merge --squash --delete-branch` after CI passes.

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
| **Review queues** (intel + campaigns): approve/deny/clear | **`docs/RUNBOOK_review_queues.md`** — read it first; do NOT re-map. Engine `auto-approve-campaigns.mjs` + janitors are already cron'd; `scripts/clear-review-queues.mjs --ai --apply` clears the residue. |

---

## Common pitfalls (do not repeat)

1. **Realtime + RLS:** if a table's SELECT policy is `to authenticated`, the realtime WebSocket needs the JWT — call `supabase.realtime.setAuth(session.access_token)` before subscribing. Tables with `to public` SELECT work without it.
2. **Realtime DELETE filtering:** if your channel filter is on a non-PK column, the table needs `REPLICA IDENTITY FULL`. Default identity logs only the PK on delete, so the filter can't match and the event is silently dropped.
3. **`e.currentTarget` in async transitions:** capture the element synchronously before `startTransition` — React nullifies `currentTarget` after the handler returns.
4. **Profile reads:** profiles SELECT RLS only allows admin or self. To read other users' public fields, call the `get_public_profile(uuid)` or `get_public_profiles(uuid[])` SECURITY DEFINER RPC.
5. **Vercel Hobby cron:** only daily intervals allowed. Sub-daily jobs go in `.github/workflows/cron-hourly.yml`.
6. **pdf-parse v2:** ESM-incompatible. Use `createRequire(import.meta.url)('pdf-parse')` then `new PDFParse(new Uint8Array(buf))` — its engine REJECTS Node Buffers (since ~2026-07; the error is swallowed by catch-blocks, so it looks like "docs undecodable"). Always wrap in `Uint8Array`.
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

The project maintainer may not be a developer. When you need a decision:
- Frame as **"X or Y?"** with a 1-line rec, not as open-ended advice
- Never ask permission for routine choices — make them and note the call in `DECISIONS.md`
- Token-efficient: don't re-explore files you've already read this session
- Don't re-grep the codebase for context you can already infer; use partial reads with offset/limit when you need fragments.

---

## Source-of-truth rule: always cross-reference `.env.local`

**Before assuming any project context — Supabase project, app URL, push keys, OAuth client ids — open `.env.local` and read what's actually configured.**

Specific failure modes this prevents:
- **Supabase MCP project mismatch.** The MCP server you're given may be connected to a *different* Supabase project than this repo's. Verify `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_PROJECT_REF` in `.env.local` against `mcp__supabase__get_project_url`. If they don't match, MCP SQL/migrations/logs are pointing at the wrong DB — fall back to `npm run db:push` and `node --env-file=.env.local scripts/*.mjs` which always read this repo's env.
- **APP_URL drift.** Local dev is `http://localhost:3001`. Prod is `https://www.ikratom.org`. When generating links/curls/cron-call examples, pull the right one from `.env.local` (local) or know it's overridden by Vercel env in production.
- **VAPID + OAuth client IDs.** Don't assume — read.

When `.env.local` and Vercel disagree on a value (and they sometimes will, e.g. APP_URL), say so explicitly in the response and pick the correct one for the context. Never guess.

---

## OAuth setup checklist (Google / Discord)

Every OAuth provider needs its **authorized redirect URI** registered in the matching developer console. If a URI isn't registered, the user sees a generic `Error 400: redirect_uri_mismatch` page on the provider's domain — they don't return to iKratom at all, so iKratom can't show a friendly error.

**Required redirect URIs to register for each environment:**

| Environment | URI suffix to add |
|---|---|
| Production (canonical) | `https://www.ikratom.org/api/oauth/<provider>/callback` |
| Vercel preview | `https://ikratom.vercel.app/api/oauth/<provider>/callback` |
| Local dev | `http://localhost:3001/api/oauth/<provider>/callback` |

Register all three in each provider's console so the same client works everywhere.

**Providers + consoles:**

- **Google** (Gmail send-on-behalf): https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client IDs → your client → Authorized redirect URIs
- **Discord** (link account): https://discord.com/developers/applications → your app → OAuth2 → Redirects

**Diagnostic surface:** `/admin/oauth-config` shows the live URIs the app generates per provider, plus which env vars are set. Use it to spot-check before debugging code.

---

## Working partnership

Working style for AI contributors collaborating with the maintainer:

- **Lean on available capability.** Use `gh`, Bash, browser MCPs (Vercel/Resend/Discord/Stripe portals), the Supabase MCP (when project ref matches — see above), and full file-system access. Don't punt to a human for things you can do directly.
- **Ask only when you can't proceed.** Picking design direction or pasting secret values that can't be self-served warrants a question. Almost everything else, just do it.
- **One round-trip > five.** Batch tool calls (parallel Bash, parallel Agents).
- **Save state in code, not chat.** Anything reusable becomes a script in `scripts/`, an admin server action, a migration, or a doc — not a one-off chat instruction.

---

## Token discipline (post-premium-Claude)

The maintainer no longer has premium Claude access. Per-session conversation cost is the only AI cost surface (the platform itself is free-tier-only — see CLAUDE.md). Operate under these norms:

- **Don't re-read** files already in this session's context. Re-derive from what you already know.
- **Use partial reads** (`offset`/`limit`) for files >300 lines. Never read a file twice in the same session.
- **Explore agents for multi-file reads** — cheaper than chained Read calls. One agent, one focused question.
- **Batch tool calls.** One message = one logical step with all parallel tool calls in it. Don't ping back and forth.
- **PR bodies: 1–2 sentences.** The commit message already has the detail. The PR body is a headline, not a recap.
- **Chat: lead with the answer.** Skip preamble, recap, "great question," and post-commit summaries. The user knows what they just asked.
- **Skip preview verification** for route/script changes with no UI surface. Verify only when a human would actually look at it in a browser.
- **Defer non-essential builds.** Flag as "v2" instead of building speculatively. Surface area is not the goal anymore; sustainability is.
- **Default cadence: lean autonomous.** A "continue" run = one focused PR, not a multi-PR batch. If a second PR's truly needed, name it and stop — let the user say go.

If the maintainer points you at `private/CONVERSATION_DISCIPLINE.md`, it's because you've drifted from these norms. Re-read this section.

---

## Standing rules (carry across EVERY session — non-negotiable)

These were established over many sessions. They are not per-task; they always apply.

1. **Public anonymity.** In ANY surface other users can see (lounge, forum, comments, activity feeds, public profiles, DM pickers, leaderboards), render identity ONLY via `publicHandle()` from `src/lib/public-handle.ts` → `@username`. **Never** render `full_name` or `email` in a public surface. `full_name` is for private/legitimate use only (campaign mailto sender name, the user's own dashboard). Cross-user profile reads go through `get_public_profile`/`get_public_profiles` (SECURITY DEFINER, public-safe columns) — never a direct `profiles` select of another user. When adding any new public surface, wire it through `publicHandle` from the start.
2. **Free-tier AI only.** Groq / Gemini Flash / Ollama / Cerebras. The router disables `claude`. No code path may depend on a paid AI API. Platform policy, not a guideline.
3. **No production DB writes from the chat agent without an explicit owner ask.** The auto-mode classifier blocks this and it's correct. Reads/diagnostics are fine; mutations (including "helpful" backfills or toggles) need the owner to say so.
4. **Public repo hygiene.** The GitHub repo is PUBLIC. Never commit secrets, service-role keys, `.env*` (only `.env.local.example`), or anyone's personal info. Keep owner PII out of tracked code — prefer a role address (e.g. `contact@ikratom.org`) over a personal email in User-Agent strings / NOTICE / docs. `private/` is gitignored — working notes, plans, and anything sensitive live there.
5. **Keep the brief current.** Update `private/V2_KICKOFF.md` whenever you ship something or learn something material, so the next session starts with perfect context and never re-does done work. It is the single source of truth.
6. **Self-monitoring + self-healing by default.** New cron sources get registered in `check-cron-staleness.mjs`. Scripts self-heal transient errors (retry, skip-bad-item) and write `scraper_runs` telemetry. If something can't be auto-fixed, surface it (push/alert) and note it in V2_KICKOFF — don't let it fail silently.
7. **Every merge to `main` costs 15 Netlify credits out of 300/month — batch them.** A squash-merge triggers a production build, so the merge *is* the spend. 15 deploys in nine days spent 225 credits (75% of the budget) and the site was disabled on 2026-07-30. Still one focused PR per task, but **land related PRs in one merge window**, and run `npm run credits` before merging (CI's "Netlify credit budget" check brakes at 90%). **Never run `netlify deploy --prod`** — it publishes a second billable deploy on top of the git build. Verify with the PR deploy preview or a DRAFT deploy (`netlify deploy --build`, no `--prod`). **One focused PR per task. Verify with `npx tsc --noEmit`. Squash-merge. Migrations via `npm run db:push`** (next number tracked in V2_KICKOFF).
8. **Parallel sessions: one git worktree each — NEVER share a checkout.** Multiple sessions in one working tree share one `.git/index` + `HEAD`; a commit from session A silently sweeps in files session B staged (this is how PR #608 absorbed all of PR #607, 2026-06-14). Each session works in its **own worktree** with its own index/HEAD: `git -C <repo> worktree add ../ikratom-<task> -b <branch> origin/main`, then junction `node_modules` + copy `.env.local` (both gitignored, absent in a fresh worktree — and so is `private/`, so always read/write the brief in the main checkout). Defense-in-depth even inside a worktree: **branch from `origin/main` after fetch (never local `main`); commit with an explicit pathspec — `git commit -m "…" -- <paths>` — so only those paths land; before `gh pr merge`, run `gh pr view <n> --json files` and confirm the file list matches your intent; never commit on or push `main` directly.** Full rationale + setup helper: `private/PARALLEL_SESSIONS_PLAN.md` + `scripts/new-session-worktree.ps1`.
9. **Self-evolving by default — use every capability, keep extending them (owner ask 2026-06-22).** Use the full toolbelt already wired in: the free AI router (`scripts/lib/ai-router.mjs` auto-uses Groq/Cerebras/Gemini/Mistral/Cloudflare/SambaNova/OpenRouter/NVIDIA/GitHub-Models/Ollama — every provider whose key is set), SearXNG, Playwright/headless-Chromium, Wikidata SPARQL + Census geocoder/adjacency (keyless), and all session MCP tools. **When you discover a new capability that's FREE + open-source/free-tier and in-scope, adopt it** (a new keyless data source, a faster path, an OSS lib that removes a gap) and wire it so the router/pipeline picks it up automatically. **And proactively surface, in your report, concrete improvements the owner could unlock + exactly what he must do** (create an account, paste a key, make a decision) — he wants a platform that keeps evolving itself. This is the growth twin of rule 6 (self-monitoring) and the token-discipline norms: evolve cheaply, **verify everything you add** (rule 7), never introduce a paid dependency (free-tier-only is platform policy).
