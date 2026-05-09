# Secrets + API key setup

How to provision every API key in `.env.local` (and Vercel prod env). Order: critical first, optional last.

## Already wired (don't touch unless rotating)

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ACCESS_TOKEN` / `SUPABASE_PROJECT_REF` — Supabase
- `OPENSTATES_API_KEY` — OpenStates
- `LEGISCAN_API_KEY` — LegiScan
- `GOOGLE_CIVIC_API_KEY` — Google Civic
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` — Sign in with Google
- `DISCORD_OAUTH_CLIENT_ID` / `DISCORD_OAUTH_CLIENT_SECRET` — Discord linking
- `RESEND_API_KEY` / `RESEND_FROM_EMAIL` / `RESEND_FROM_NAME` — Transactional email (live)
- `GROQ_API_KEY` / `GEMINI_API_KEY` / `CEREBRAS_API_KEY` / `ANTHROPIC_API_KEY` — AI providers
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` — Web push
- `CRON_SECRET` — Bearer token for /api/cron/* endpoints
- `APP_URL` — Origin of deployed app

---

## AI providers — added 2026-05-09

Each adds a free-tier rotation slot to `scripts/lib/ai-router.mjs`. When one cools down, the next picks up — overnight job throughput scales linearly with the number of providers wired.

### Cloudflare Workers AI
**10,000 neurons/day free** (~100-200 generations).

1. Sign in at https://dash.cloudflare.com — sign up if needed (free, no card)
2. Top of dashboard sidebar shows **Account ID** — copy it
3. **My Profile** (top-right) → **API Tokens** → **Create Token**
4. Pick template **"Workers AI"** → Continue → Continue → Create Token
5. Copy the token (only shown once)

```bash
CLOUDFLARE_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
CLOUDFLARE_AI_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Models we use: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (text), `@cf/meta/llama-3.2-11b-vision-instruct` (vision/OCR for advocate-uploaded agendas).

### Mistral AI
**Generous free tier**, fast inference.

1. Sign up at https://console.mistral.ai (no card for free tier)
2. **API Keys** → **Create new key** → name it "iKratom"
3. Copy

```bash
MISTRAL_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Models: `mistral-small-latest` (default), `mistral-medium-latest` (when we need quality).

### Cohere — embeddings (next-week priority)
**Trial tier covers our retrieval needs.**

1. Sign up at https://dashboard.cohere.com
2. **API Keys** → Trial Key (auto-created) → copy

```bash
COHERE_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Use: `embed-english-v3.0` for "find similar bills" search.

### Voyage AI — backup embeddings (next week)
**200M tokens free.**

1. https://dash.voyageai.com — sign up
2. **API Keys** → Create

```bash
VOYAGE_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### OpenFEC — donor data (next week, big lift)
Federal legislator campaign-finance data via the official FEC API. **Replaces OpenSecrets**, which paused API signups mid-2025.

1. https://api.data.gov/signup/ — fill the form (instant, no review)
2. Key emailed within 1 min
3. 1,000 requests/hr free, plenty for our use

```bash
OPENFEC_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Use: per-legislator donor profile, surfaced inline on campaign pages — *"Senator X took $42k from pharma in 2024"* is a narrative tool for advocate emails.

### Sentry quick reference
- `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` are **the same value** — paste your DSN into both. The `NEXT_PUBLIC_` one ships to the browser, the bare one is server-only.
- `SENTRY_ORG` = the slug from your URL (e.g. `sentry.io/organizations/<slug>/...` — that slug)
- `SENTRY_AUTH_TOKEN` = User Settings → Auth Tokens → Create New (scopes: `project:releases` + `org:read`). Only needed for source-map uploads on prod builds — Sentry still captures errors without it, just shows minified stack traces.
- `SENTRY_PROJECT` = `ikratom`

---

## Observability — added 2026-05-09

### Sentry — error capture
**Free tier: 5k errors/month**, plenty for our scale.

1. Sign up at https://sentry.io (no card)
2. **Create Project** → Platform: **Next.js** → name: `ikratom`
3. After creation, the dashboard shows the **DSN** — looks like `https://abc123@o123456.ingest.sentry.io/789`
4. **Settings → Auth Tokens → Create New Token** → scopes: `project:releases` + `org:read` — for source-map uploads on prod builds
5. Org slug + project slug both visible in any Sentry URL: `sentry.io/organizations/<org>/projects/<project>/`

```bash
NEXT_PUBLIC_SENTRY_DSN=https://abc@o123.ingest.sentry.io/456
SENTRY_DSN=https://abc@o123.ingest.sentry.io/456
SENTRY_AUTH_TOKEN=sntrys_xxxxxxxx
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=ikratom
```

### PostHog — analytics + session replay + feature flags
**Free tier: 1M events/month + 5k session recordings/month**.

1. Sign up at https://us.posthog.com (or `eu.posthog.com` for EU hosting; pick once, can't switch)
2. New project → "Web app"
3. Project Settings → **Project API Key** (starts `phc_…`) — copy

```bash
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Then in PostHog UI:
- **Privacy → Mask all inputs by default** — protects user-typed addresses, story text, etc.
- **Session replay → Sampling rate: 25%** — covers free tier comfortably while giving us enough debug visibility

---

## Future placeholders (no instructions yet)

```bash
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
UPTIMEROBOT_API_KEY=
UPTIMEROBOT_WEBHOOK_URL=
```

When you're ready: Cloudflare Turnstile = signup-form bot prevention; UptimeRobot = ping the prod URL every 5 min and alert on downtime.

---

## After adding any key locally

Mirror the same value into Vercel:

1. https://vercel.com → ikratom project → **Settings → Environment Variables**
2. Add each key with the same name + value
3. Apply to: **Production, Preview, Development** (all three)
4. Redeploy: `vercel --prod` or push a commit

The local `.env.local` controls dev + scripts. Vercel env controls prod runtime.
