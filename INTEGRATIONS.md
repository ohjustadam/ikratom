# iKratom — Integrations

External APIs and SDKs the platform uses, and the ones it deliberately does not.
_Reviewed 2026-10-25. This file was a plan until then; it now describes what is built.
For where everything runs, see [`STATE_OF_PLAY.md`](STATE_OF_PLAY.md)._

## ✅ Integrated

| API | Purpose | Used in |
| --- | --- | --- |
| **Supabase** | Auth, DB, RLS, Realtime, Storage | Everything |
| **OpenStates v3** | State legislator sync (250 requests/day per key, so the keyless `openstates/people` bulk repo carries the load) | `scripts/sync-legislators.mjs`, `src/lib/sync/openstates.ts` |
| **LegiScan** | Bill tracking + status changes | `scripts/sync-bills-via-legiscan.mjs`, `scripts/sync-legiscan-datasets.mjs`, `/bills` |
| **US Census Geocoder** | Address → districts (cd / sldu / sldl). Replaced Google Civic Info (sunset 2025). Free, no API key. | `src/lib/civic.ts`, called from profile save |
| **Gmail API** (`gmail.send` only) | Members send letters from their own Gmail, one click | `src/lib/email/gmail.ts` |
| **Microsoft Graph** (`Mail.Send`) | Same, from Outlook | `src/lib/email/outlook.ts` |
| **SMTP app passwords** | Same, for Yahoo, AOL and iCloud (since 2026-10-22). Stored AES-256-GCM encrypted | `src/lib/email/smtp.ts` |
| **Resend + Brevo** (free tiers) | Platform mail only: signup, resets, notices, digests | `src/lib/email/transactional.ts`, `src/lib/email/router.ts` |
| **Web Push (VAPID)** | Push notifications, no third party | `src/lib/push/`, `public/sw.js` |
| **Discord** | Outbound webhooks to server channels, and account linking via OAuth | `src/modules/discord/`, `src/app/api/oauth/discord/` |
| **Free AI pool** | Groq, Gemini, Mistral, NVIDIA, Cloudflare, OpenRouter free models, Ollama locally | `scripts/lib/ai-router.mjs`, `src/lib/ai/` — keys in [`docs/AI_PROVIDERS.md`](docs/AI_PROVIDERS.md) |

Federal members come from the keyless `unitedstates/congress-legislators` dataset, not a
Congress API key.

## ⚡ Send-on-behalf (the one-click letter)

This is what makes one-click batch sending real. A `mailto:` link opens the member's mail
client with the message pre-filled; they still click Send. With a connected account,
iKratom sends N personalized emails to N legislators with a single button, and each one
lands in the member's own Sent folder, addressed by name. `mailto:` stays as the fallback
for anyone who has not connected a mailbox, and when a send fails (expired token and so on).

### Why this is the differentiator

Form-letter mass emails get filtered as spam. Personalized emails from a constituent's
actual address are read. Other tools force a choice between scale (mass blast) and
authenticity (one by one). Sending from the member's own mailbox gives both.

### One-time setup for Google (by the owner)

1. **console.cloud.google.com** → the iKratom project → **APIs & Services → Library** →
   enable **Gmail API**.
2. **OAuth consent screen** (now under **Google Auth Platform**):
   - User type **External**, app name `iKratom`, support and developer contact addresses.
   - Scope: `https://www.googleapis.com/auth/gmail.send` and nothing else.
3. **Credentials → Create credentials → OAuth client ID**, type **Web application**:
   - Authorized redirect URIs:
     - `https://www.ikratom.org/api/oauth/google/callback`
     - `http://localhost:3001/api/oauth/google/callback` (local dev)
   - Put the **Client ID** and **Client secret** in `.env.local`, the Netlify environment
     variables and, if a job needs them, the GitHub Actions secrets:
     ```
     GOOGLE_OAUTH_CLIENT_ID=...
     GOOGLE_OAUTH_CLIENT_SECRET=...
     APP_URL=http://localhost:3001      # local; production is https://www.ikratom.org
     ```
4. Restart the dev server.

`gmail.send` is a "sensitive" scope. While the OAuth client is in **Testing** mode, only
the 100 test users you list can ever connect Gmail (a lifetime cap) and each sees an
"unverified app" warning. Submitting it for Google verification lifts that — the full
walkthrough is [`GOOGLE_OAUTH_VERIFICATION.md`](GOOGLE_OAUTH_VERIFICATION.md). Outlook and the
SMTP providers do not need a review.

### Architecture

- `email_integrations` table: one row per member (PK `user_id`) holding the provider
  (`gmail`, `outlook`, `yahoo`, `aol`, `icloud`), `account_email`, and an encrypted
  `refresh_token` (for the SMTP providers, the encrypted app password). Never exposed to
  the client.
- `/api/oauth/google/start` and `/callback` (and the `outlook` pair): CSRF state, code
  exchange, token stored through the service role.
- `src/lib/email/user-send.ts`: the provider-agnostic dispatcher. `gmail.ts` mints a fresh
  access token from the refresh token, builds the RFC 2822 message and posts it to
  `gmail.users.messages.send`; `outlook.ts` does the same through Graph; `smtp.ts` uses
  nodemailer.
- `sendCampaignViaGmail()` in `src/modules/campaigns/actions.ts` and the durable send queue
  (`src/modules/campaigns/drain-batch.ts`) iterate the targets, send one email each, and
  log to `campaign_actions`.
- UI: `/account` shows Connect and Disconnect; a campaign shows the one-click send button
  when a mailbox is connected.

## 🔵 Forum + notifications

| Feature | Approach |
| --- | --- |
| Per-state forum threads | Supabase tables `forum_threads`, `forum_posts`, RLS by state membership |
| Notifications | In-app inbox plus browser push via the Web Push API (free, no third-party) |
| Email digests | Opt-in only, sent through platform mail (Resend and Brevo free tiers; Resend allows 100 a day, shared with auth mail) |

## 🔴 Things we will NOT integrate

- **Stripe / payment processors** — iKratom is not a marketplace
- **Facebook / X SDKs** — explicitly counter-positioned
- **Any paid AI API**, Anthropic's included — platform policy; the router disables `claude`
- **Host-only services** (Vercel KV/Postgres/Blob, Netlify Blobs) — Supabase and Cloudflare
  R2 cover storage, so the app stays host-portable
