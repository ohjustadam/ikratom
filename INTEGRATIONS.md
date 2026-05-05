# iKratom — Planned Integrations

External APIs and SDKs we will integrate as we expand the platform.

## ✅ Already integrated

| API | Purpose | Used in |
| --- | --- | --- |
| **Supabase** | Auth, DB, RLS | Everything |
| **OpenStates v3** | State legislator sync | `scripts/sync-legislators.mjs`, `src/lib/sync/openstates.ts` |
| **US Census Geocoder** | Address → districts (cd / sldu / sldl). Replaced Google Civic Info (sunset 2025). Free, no API key. | `src/lib/civic.ts`, called from profile save |

## 🟡 Pending API key

| API | Purpose | Where it goes |
| --- | --- | --- |
| **LegiScan** | Bill tracking + status changes | `src/lib/sync/legiscan.ts` (to build), `/bills` page |
| **ProPublica Congress** | U.S. Senate / House sync (alt to LegiScan) | `src/lib/sync/congress.ts` (to build) |
| **Anthropic / Claude** | AI-personalized email drafts, news scraping summaries | Server actions in admin tools |

## ⚡ Gmail OAuth — DONE (Outlook still pending)

### Setup steps (one-time, by an admin)

1. Go to **console.cloud.google.com** → your iKratom project (or create one)
2. **APIs & Services → Library** → search "Gmail API" → **Enable**
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: `iKratom`
   - User support email: yours
   - Developer contact: yours
   - Scopes: add `https://www.googleapis.com/auth/gmail.send`
   - Test users: add `ohjustadam@proton.me` (and any other accounts you want to test with)
4. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `iKratom Gmail OAuth`
   - Authorized JavaScript origins: `http://localhost:3001` (and your prod URL when deploying)
   - Authorized redirect URIs:
     - `http://localhost:3001/api/oauth/google/callback`
     - (add prod URL too: `https://yourdomain.com/api/oauth/google/callback`)
   - Save → copy **Client ID** and **Client secret** into `.env.local`:
     ```
     GOOGLE_OAUTH_CLIENT_ID=...
     GOOGLE_OAUTH_CLIENT_SECRET=...
     APP_URL=http://localhost:3001
     ```
5. Restart the dev server.

### Verification checks (gmail.send is "sensitive" but doesn't require Google verification for use by test users)

While the app is in **Testing** mode in OAuth consent screen, only the test users you added can connect. To go public, submit for Google verification (~1 week) — required before launch.

### Architecture

- `email_integrations` table: stores `refresh_token` (long-lived), `account_email`, scopes
- `/api/oauth/google/start`: generates CSRF state, redirects to Google consent
- `/api/oauth/google/callback`: validates state, exchanges code, stores refresh token via service role
- `src/lib/email/gmail.ts`: `sendViaGmail()` mints a fresh access token from refresh, builds RFC 2822, POSTs to `gmail.users.messages.send`
- `sendCampaignViaGmail()` server action: iterates targets, sends one personalized email each, logs to `campaign_actions` with method=`platform_email`
- UI: `/account` shows Connect/Disconnect; campaign action shows the green "⚡ One-click send" button when connected

## 🔮 Next: Outlook OAuth (Microsoft Graph)

This is what makes one-click batch sending real. Today we use `mailto:` links — the user's email client opens with the message pre-filled. Works, but the user still has to click Send. With OAuth, iKratom can send N personalized emails to N legislators with a single button — each one appearing in the user's own Sent folder, addressed by name.

### Architecture
1. User clicks **"Connect Gmail"** in `/account`
2. OAuth flow: Google consent screen → permission `gmail.send` → callback → store refresh token in `profiles.gmail_refresh_token` (encrypted at rest by Supabase Vault, **never** exposed to client)
3. Same for Outlook via Microsoft Graph (`Mail.Send` scope)
4. On campaign action: server action calls Gmail API for each legislator, with per-legislator personalization (real name in greeting), rate-limited to ~1/sec to stay under quotas
5. Failures (token expired, etc.) fall back to mailto: gracefully

### Why this is the differentiator
Form-letter mass emails get filtered as spam. Personalized emails from a constituent's actual address are read. Today's tools force users to choose between scale (mass blast) and authenticity (one-by-one). OAuth send gives both.

### What we need to build
- [ ] Google OAuth client (free) — Cloud Console → "Gmail API" → OAuth 2.0
- [ ] Microsoft Graph app registration (free) — Azure portal → app registration → `Mail.Send` scope
- [ ] Add cols to `profiles`: `gmail_refresh_token`, `outlook_refresh_token`, `email_provider`
- [ ] `/api/oauth/google/callback` and `/api/oauth/microsoft/callback` route handlers
- [ ] `src/lib/email/gmail.ts` and `src/lib/email/outlook.ts` send adapters
- [ ] Token refresh logic (Gmail tokens expire after 1 hr, refresh tokens last indefinitely if used)
- [ ] Update `CampaignAction.tsx` — when user has provider connected, use programmatic send instead of mailto
- [ ] Per-legislator template vars now actually personalize each email

### Estimated build: 1 focused session (~3 hours)

### Why not now
1. v1 needs a working campaign action first (done in this build) so we can validate the user flow
2. OAuth setup requires creating Google Cloud OAuth client + verifying domain ownership for production. Best done after we have a domain.
3. Mailto: gets us 80% of the way — single mailto with all reps in BCC is one click, single Send. Good enough to launch.

## 🔵 Forum + notifications (later)

| Feature | Approach |
| --- | --- |
| Per-state forum threads | Supabase tables `forum_threads`, `forum_posts`, RLS by state membership |
| Notifications | Supabase `pg_notify` + browser push via Web Push API (free, no third-party) |
| Email digests | Resend free tier (3k/mo) for daily/weekly summaries — opt-in only |

## 🔴 Things we will NOT integrate

- **Stripe / payment processors** — iKratom is not a marketplace
- **Facebook / X SDKs** — explicitly counter-positioned
- **Discord** — user's own framing: "lacking in something of substance"
- **Vercel-only services** (KV, Postgres, Blob) — see `MIGRATION.md`
