# iKratom — The Advocate's Toolbelt

## What This Is
A nonpartisan political action platform for the kratom advocacy community. Independent of any org (AKA, GKC, BAE, MAC). The mission: turn hours of advocacy work — sending legislator emails, tracking bills, finding contacts — into a few minutes a day, with one-click actions backed by real data.

This is **separate** from Iron Gate (the marketplace at `C:\claude\marketplace\`). Different audience, different brand, different purpose.

## Product Rules (MUST follow)
- **Nonpartisan.** Never lean toward an org or political side. The platform is a tool, not a faction.
- **Empower the advocate, not the org.** Features should remove friction for the individual taking action.
- **One-click is the standard.** If a flow takes more than 1–2 clicks, it's broken.
- **Free-tier only.** No paid APIs. Members send letters from their OWN mailbox: one-click through their connected Gmail or SMTP account, or a `mailto:` link. Platform mail (signup, resets, notices) uses the free tiers of Resend and Brevo. (Owner, 2026-10-23: this replaces the v1 "mailto only, no email service" rule.)
- **Real data only.** Bill status, legislator contact info, news — must be scraped/synced, never manually maintained beyond seed.
- **Recruitment angle.** Shop owners and medical professionals are first-class users — features should make it easy for them to opt in to advocacy.
- **Public anonymity.** Users appear by `@username` only in every public surface (chat, forum, activity, profiles, DM). Never expose real name or email between users — render via `publicHandle()` (`src/lib/public-handle.ts`). Users act as themselves privately (campaign sends use real name); publicly they stay anonymous by default.

## Roles
- **Owner** — `profiles.is_owner = true`. Highest privilege. Can promote/demote admins. Exactly one. The owner email is stored in environment config (`OWNER_EMAIL`), not committed to the repo.
- **Admin** — `profiles.is_admin = true`. Can moderate users, manage campaigns/legislators/bills/states/forum.
- **User** — default. Can read public data, manage own profile, take campaign actions.

Admin checks live in `src/modules/admin/actions.ts::getAdminContext()`. RLS policies use the `is_admin(uid)` SQL function. **Never** trust client-side admin flags — always re-check server-side before mutations.

## Scope today
v1 (the action engine) shipped in 2026, and much more is live: all 50 states, forum, news, library, groups and one-click sending. `STATE_OF_PLAY.md` describes what runs where.

What is still deliberately held off is the set of `false` flags in `src/config/site.config.ts`: `proSubscription`, `medicalRecruitment`, `aiPersonalization` and `briefMvpTeaser`. Don't build behind a `false` flag unless the owner says so. The forward plan is `private/PLAN_OF_ACTION.md` §5, on the owner's machine.

## Tech Stack
- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 for styling
- Supabase for database, auth, RLS
- Free legislative APIs: LegiScan (bills), OpenStates (legislators), Google Civic Information (address → reps)
- AI: **free-tier providers only**: the free router pool (Groq, Gemini on a no-billing key, Mistral, NVIDIA, Cloudflare, OpenRouter free, Ollama). Status is in `docs/AI_PROVIDERS.md`. Cerebras is dead (paid). The router (`src/lib/ai/router.ts`) explicitly disables `claude` and no path may add code that depends on a paid AI API. This is platform policy, not a guideline.

## Folder Structure
```
src/
  app/           # Next.js pages and routes
  components/ui/ # Shared UI components
  config/        # Site config, feature flags
  lib/           # supabase client/server, helpers
  modules/       # Feature modules (created as we build)
    auth/        # Login, signup, profile
    campaigns/   # Campaign list + action UI
    legislators/ # Sync + lookup
    bills/       # Sync + display
  types/         # Shared TS types
supabase/
  migrations/    # SQL migrations (numbered)
```

## Conventions
- Server components by default; `"use client"` only for interactivity
- Tailwind classes directly; avoid custom CSS
- Money/dates: timestamptz in DB, ISO strings in TS
- Keep components under ~100 lines
- All DB tables flat (no nested JSON), CSV-exportable
- Email templates use `{{variable}}` placeholders rendered server-side before the letter is sent or the `mailto:` link is built

## Important Next.js 16 Notes
- `proxy.ts` replaces `middleware.ts`. Ours is disabled (`src/proxy.disabled.ts`, since 2026-07-26: Netlify's adapter can't bundle it)
- `cookies()` and `headers()` are async — must use `await`
- Read docs in `node_modules/next/dist/docs/` before using unfamiliar APIs

@AGENTS.md
