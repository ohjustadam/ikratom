# Morning brief — 2026-05-09

## What shipped overnight (9 PRs)

| PR | Title | Impact |
|----|-------|--------|
| #79 | docs: SECRETS.md setup guide | Single source of truth for every API key + Vercel env mirroring |
| #80 | ai-router: Cloudflare Workers AI + Mistral | 5 cloud providers now in rotation (was 3). Better overnight throughput when Groq/Gemini cool down |
| #81 | fix: San Buenaventura bugs + bill title slop | LocalActionPlaybook stops rendering parked-domain links; cards no longer wrap as anchors; bill titles cap at first em-dash |
| #82 | feat: /leader stub + URL validation in seed | New `/leader` panel mirrors `/admin`. seed-bill-officials now HEAD-checks URLs against parked-domain blacklist |
| #83 | feat: Sentry + PostHog observability | Errors → Sentry dashboard. Sessions → PostHog replay. Privacy-respecting (masked inputs) |
| #84 | feat: profile character-fields + topbar avatar + name fallback | Migration 0075 adds 12 columns. Topbar shows avatar + @username. Send-time falls back to @username if no real name |
| #85 | feat: notification bell flyout | Click bell → in-page panel. No more lost work tabs |
| #86 | feat: 3 home page drafts | `/home-a` (intel), `/home-b` (recruitment), `/home-c` (action-first) — pick one in the morning |
| #87 | feat: /account/character + /dashboard/templates | Character editor (story, what's at stake, advocate type, etc.) + email preview page |

## Live data fixes during the run

- **Marshall, IL campaign** — retargeted from 174 wrong state legs to 9 correct local officials (mayor + 8 council)
- **San Buenaventura, CA campaign** — re-seeded successfully when Gemini quota recovered. 7 council members with real `@cityofventura.ca.gov` emails. URL validation dropped 5 fake URLs Gemini hallucinated. City contact: `805-654-7800`, contact form, mailing address, council meeting page, all 7 fields populated.
- **Bill 0075 migration** — applied. profiles now has: avatar_url, kratom_story, kratom_years, advocate_type, lose_if_banned, video_url + provider, referrer_id, tour_seen jsonb, onboarded_at, sms_consent_at, profile_visibility.

## Overnight backfills (still running)

| Job | Progress | Notes |
|---|---|---|
| Bill journey enrichment | **63 / 450** done in 8h | Ollama llama3.3:70b + cloud rotation. Slow per-bill but unlimited |
| News classification | **607 / 2620** done in 8h | Cloud-rotation (Groq/Gemini/Mistral/CF/Cerebras) |
| Translations | 1 row finished | llama3.2:3b is slow — may need to switch to llama3.3:70b for quality/speed mix |
| Vision model pull | ✓ **`llama3.2-vision`** installed | Ready for OCR work on agenda PDFs |

The hourly cron is also still firing — picking up new news items, classifying them, auto-spawning campaigns, posting bills to forums.

## Items deferred (intentional — need your eyes)

These were on tonight's plan but I held off because they're meaty UX work where output quality matters more than completion count. Each takes 60-90 min of deliberate work:

1. **Onboarding rewrite** — existing 377-line wizard works; rewriting in the character-creation framing needs your copy decisions on each step. Better fresh tomorrow.
2. **Field signup magic-link flow** — full leader-handoff UX. Needs your call on first-name-vs-email-only, what shows up in the leader's recruit feed, etc.
3. **First-visit tooltips infrastructure** — `profiles.tour_seen` column is already added, need the UI infrastructure (Tooltip component, dismiss tracking, surface-by-surface copy)
4. **AI personalize uses kratom_story** — the `ai_personalize` column on campaigns exists but the actual codepath isn't built yet (it's a flag with no implementation). Whole feature is its own PR — needs prompt design + LLM call site.
5. **Cloudflare R2 video upload UI** — story field accepts URL today (good enough for v1). Adding direct upload is its own ~2hr PR with a presigned-URL flow.
6. **OpenFEC integration** — key is now in env. Wiring per-legislator donor profiles is a substantial feature — its own PR.

## Tomorrow's recommended order

1. **Visit `/home-a`, `/home-b`, `/home-c`** on your phone + desktop. Pick a direction. We refine + replace `/`.
2. **Click through the new `/account/character` flow** as if you're a new user. Note any field that confused you.
3. **Visit the Marshall + San Buenaventura campaign pages**. Confirm they look correct now.
4. **Check `/admin/intel-health`** — should show fresh scraper_runs from overnight + the cloud-provider rotation data.
5. **Spot-check Sentry + PostHog dashboards** — confirm they're receiving events.
6. Then we tackle: pick a home page → onboarding rewrite → field signup flow → AI personalize.

## Sentry SETUP_AUTH_TOKEN

Found the actual current path (UI changed mid-2024). Updated `docs/SECRETS.md`:

> Settings (gear icon, top-right) → **Developer Settings** → **Auth Tokens** → **"Organization Tokens"** tab → Create New Token. Scopes: ✅ `project:releases` + ✅ `org:read`. Direct URL: https://sentry.io/settings/auth-tokens/. Token starts `sntrys_…`, only shown once.

When you have it: paste into `SENTRY_AUTH_TOKEN` (and mirror to Vercel). Sentry already works without it for error capture; auth token just enables source-map upload so stack traces aren't minified.
