# User TODO list — free-only, ranked by leverage

> Owner directive (2026-05-12): free tier only for now. Paid items are
> noted for future reference but don't act on them until budget allows.
> I (Claude) updated this list focusing on what you can do **for free
> tonight** that unlocks the next round of capabilities.

---

## 🟢 Do tonight — all 100% free, no credit card

### Account creation / API keys (15 min each)

- [ ] **GitHub fine-grained PAT — add `Contents: Read+Write` + `Pull Requests: Read+Write`**
  - **Why it matters:** Lets me open PRs directly when I spot a fix (cron failures, lint errors, dependency bumps). Today I have to ask for each merge.
  - **How:** github.com/settings/tokens?type=beta → new fine-grained token → `ohjustadam/ikratom` repo → set permissions → copy token.
  - **Add as:** Secret `IKRATOM_BOT_TOKEN` in github.com/ohjustadam/ikratom/settings/secrets/actions

- [ ] **Brave Search API key (free, 2000 req/mo)**
  - **Why it matters:** Free alternative to paid Tavily. Used as backup grounded-search when Gemini Search hits quota during stance drafts + briefing generation.
  - **How:** api-dashboard.search.brave.com → email signup, no card.
  - **Add as:** `BRAVE_API_KEY` in Vercel env + GitHub Actions secrets

- [ ] **OpenSecrets API key (free, instant)**
  - **Why it matters:** Donor mapping per legislator → Tier 5 adversary intel. Unlocks "who funds this hostile legislator and what does the donor pattern tell us about their position?" analysis.
  - **How:** opensecrets.org/api/admin/index.php
  - **Add as:** `OPENSECRETS_API_KEY`

- [ ] **OpenStates API key bumped to higher tier (still free)**
  - **Why it matters:** Current quota limits sponsor-sync to ~50 bills/run. With higher free tier we can back-fill the other 49 states quickly.
  - **How:** openstates.org/api/register/ — already have a key, but the free tier resets after a year. Verify it's current.

- [ ] **PostHog Cloud free tier (1M events/month)**
  - **Why it matters:** Product analytics. AI can answer "which features aren't getting used so we can cut them" via PostHog MCP.
  - **How:** posthog.com — free signup, 1M events/mo free, no card.
  - **Add as:** `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` to Vercel (note: we already have `posthog-js` + `posthog-node` in package.json, just need to wire keys).

- [ ] **GlitchTip free tier OR Sentry hobby (free)**
  - **Why it matters:** Error monitoring. AI can investigate exceptions from cron jobs.
  - **GlitchTip option (recommended, fully OSS):** glitchtip.com — Sentry-compatible API, generous free tier, fully open source so we can self-host later if needed.
  - **Sentry option:** sentry.io — free for 1 dev, 5k errors/mo.
  - **Add as:** `SENTRY_DSN` (works with both — we already have `@sentry/nextjs` installed).

### GitHub settings (5 min)

- [ ] **Enable repo auto-merge:** github.com/ohjustadam/ikratom/settings → General → "Allow auto-merge" — PRs auto-merge on green CI, eliminates the manual squash-each-time loop.

- [ ] **Enable branch protection on `main` (optional, recommended):** Settings → Branches → Add rule for `main` → "Require status checks to pass" + "Restrict who can push to matching branches: include administrators". Forces all changes through PR review.

### Stance review (high-leverage manual work, ~30 min)

- [ ] **Visit `/admin/stance?state=NY`** and review the 153 AI-drafted legislator stances.
  - Most should be confirmed as-is (the AI was conservative — 82 are flagged "unknown" honestly).
  - Focus on the **8 champions and 16 hostile** — those are the actor-level intelligence. Confirm or flip them based on what you know.
  - Each row takes 5-10 seconds. Total: 25-30 min if you go through every drafted row, OR ~5 min if you just spot-check champions + hostiles.

### PWA install test (5 min on your phone)

- [ ] **Open `https://www.ikratom.org/install/android` on your Android phone OR `https://www.ikratom.org/install/ios` on your iPhone.**
  - Both pages built tonight — should give clear "Add to Home Screen" instructions.
  - Verify the app launches in standalone mode (no browser chrome).
  - Verify push notifications work (test from your `/account/security` page).

---

## 🟡 Future paid items (don't buy yet — bookmark for when revenue starts)

| Service | Cost | Free workaround in place today |
|---|---|---|
| **Browserbase** ($39/mo) | Cloudflare-bypass scraping at scale | Use **Claude in Chrome MCP** (already free, runs in your browser) — slower but works. Alternatively, **Skyvern** (open source, AGPL) self-hosted. |
| **Tavily Pro** ($30/mo) | Focused web search | Free 1000-call tier or fallback to Brave Search API (free 2k/mo). |
| **Anthropic API direct** ($5+ credits) | Claude Sonnet for high-stakes work | Currently routed via Gemini/Groq/Cerebras — works well. |
| **Twilio** (~$0.01/min) | Phone-call infrastructure | Built **tel: + Web Speech API** approach tonight — fully free, no Twilio needed for MVP. |
| **Vercel Pro** ($20/mo) | Cron subdaily + larger build limits | Currently on Hobby + GitHub Actions for sub-daily — fine for now. |

---

## 🔵 Open-source projects integrated tonight (no action needed)

These are wired into the codebase or staged for the next session:

- ✅ **Crawl4AI** — staged as drop-in for our `extractArticleBody()` helper. Next news-pipeline run will use it for cleaner extraction.
- ✅ **Claude in Chrome MCP** — already in your toolbelt; we use it for browser smoke tests. Could expand to drive scraping on Cloudflare-protected sites.
- 📋 **Skyvern** — self-hostable browser agent (defeats Cloudflare). Pinned for next session if Browserbase still off-budget.
- 📋 **OpenWebUI** — could give you a ChatGPT-style admin UI over your Ollama model + briefings/bills corpus. Pinned.
- 📋 **Langfuse** — LLM observability (self-host). Pinned for when AI usage volume justifies it.
- 📋 **Letta** — long-term memory for the briefing generator. Pinned.

---

## What I (Claude) cannot do via my access controls

Documented so you know exactly what requires your hands:

**Things I cannot do at all:**
- Create accounts on services on your behalf (Twilio, Browserbase, Sentry, etc.) — service ToS requires the human to sign up.
- Add new environment variables to Vercel deployment — you paste them via the Vercel dashboard.
- Configure paid subscriptions, accept Terms of Service, or input credit cards.
- Access your GitHub repo settings UI (can only act via `gh` CLI with your PAT).
- Configure Vercel cron schedules or project settings via UI (must use code).
- Send phone calls, SMS, or emails from your accounts (we use `mailto:` and `tel:` deep links so YOUR client sends them).
- Push to `main` without explicit approval (sandbox blocks this for safety).
- Install browser extensions on your machine.

**Things I cannot do efficiently / cleanly:**
- Scrape Cloudflare-protected sites at scale (need Browserbase OR more time-consuming Skyvern self-host). The Claude in Chrome MCP works one-by-one.
- Generate AI content from providers we don't have free-tier access to (need a key first).
- Self-host services that need a server (we have Vercel + GitHub Actions — no general-purpose VM unless you provision one).

**Things I CAN do that you should know about:**
- Read/write/delete any file in the repo.
- Run scripts in a sandboxed bash that has read/write filesystem access.
- Apply Supabase migrations via the Management API (using your existing `SUPABASE_ACCESS_TOKEN`).
- Generate AI text via the multi-provider router (Gemini/Groq/Cerebras/Mistral/Cloudflare/Ollama — all already configured).
- Use Chrome MCP to drive your browser for smoke tests + occasional scraping.
- Open PRs (currently single-merge; with `IKRATOM_BOT_TOKEN` I can also enable auto-merge).
- Schedule wake-ups to resume work after waiting for deploys/cron.

---

Last updated: 2026-05-12 — by Claude in active session.
