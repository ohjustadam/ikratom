# iKratom — The Advocate's Toolbelt

## What This Is
A nonpartisan political action platform for the kratom advocacy community. Independent of any org (AKA, GKC, BAE, MAC). The mission: turn hours of advocacy work — sending legislator emails, tracking bills, finding contacts — into a few minutes a day, with one-click actions backed by real data.

This is **separate** from Iron Gate (the marketplace at `C:\claude\marketplace\`). Different audience, different brand, different purpose.

## Product Rules (MUST follow)
- **Nonpartisan.** Never lean toward an org or political side. The platform is a tool, not a faction.
- **Empower the advocate, not the org.** Features should remove friction for the individual taking action.
- **One-click is the standard.** If a flow takes more than 1–2 clicks, it's broken.
- **Free-tier only for v1.** Use mailto: for legislator emails (opens user's mail client) — no transactional email service. No paid APIs.
- **Real data only.** Bill status, legislator contact info, news — must be scraped/synced, never manually maintained beyond seed.
- **Recruitment angle.** Shop owners and medical professionals are first-class users — features should make it easy for them to opt in to advocacy.

## Roles
- **Owner** — `profiles.is_owner = true`. Highest privilege. Can promote/demote admins. Exactly one. The owner email is stored in environment config (`OWNER_EMAIL`), not committed to the repo.
- **Admin** — `profiles.is_admin = true`. Can moderate users, manage campaigns/legislators/bills/states/forum.
- **User** — default. Can read public data, manage own profile, take campaign actions.

Admin checks live in `src/modules/admin/actions.ts::getAdminContext()`. RLS policies use the `is_admin(uid)` SQL function. **Never** trust client-side admin flags — always re-check server-side before mutations.

## v1 Scope (action engine only — no forum / library / news yet)
1. Auth (email/password via Supabase)
2. Profile with civic info (address → reps autofilled later via Google Civic API)
3. Oklahoma seeded as first state
4. One campaign with prefilled subject/body templates
5. One-click `mailto:` link per legislator that opens user's email client with personalized message
6. Action log (what user sent, when, to whom)

Forum, library, news, AI personalization, medical recruitment, multi-state — **flagged off** in `siteConfig.features`. Don't build until v1 ships.

## Tech Stack
- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 for styling
- Supabase for database, auth, RLS
- Free legislative APIs: LegiScan (bills), OpenStates (legislators), Google Civic Information (address → reps)
- Anthropic API (later — AI personalization is flagged off in v1)

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
- Email templates use `{{variable}}` placeholders rendered server-side before mailto: link is built

## Important Next.js 16 Notes
- `proxy.ts` replaces `middleware.ts`
- `cookies()` and `headers()` are async — must use `await`
- Read docs in `node_modules/next/dist/docs/` before using unfamiliar APIs

@AGENTS.md
