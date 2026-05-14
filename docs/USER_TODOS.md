# User TODO list — free-only, ranked by leverage

> Owner directive (2026-05-12): free tier only for now. Paid items are
> noted for future reference but don't act on them until budget allows.
>
> Last refreshed 2026-05-14 by Claude after consolidation push.
> See `ROADMAP.md` for full project state.

---

## 🟢 Do tonight — all 100% free, no credit card

### API keys / env vars (still pending)

- [ ] **Brave Search API key (free, 2000 req/mo)**
  - **Why:** Backup grounded-search when Gemini Search hits quota during stance drafts + briefing generation.
  - **How:** api-dashboard.search.brave.com → email signup, no card.
  - **Add as:** `BRAVE_API_KEY` in Vercel env + GitHub Actions secrets.

- [ ] **PostHog key in VERCEL ENV (most important — MCP is connected but prod can't capture events)**
  - **Why:** MCP is wired locally and dev. Production isn't firing events because `NEXT_PUBLIC_POSTHOG_KEY` isn't in Vercel deploy env. Once set, we get real funnel data.
  - **How:** posthog.com → Project settings → Project API key → paste `NEXT_PUBLIC_POSTHOG_KEY` + `NEXT_PUBLIC_POSTHOG_HOST` into Vercel env via dashboard.

- [ ] **GlitchTip free tier OR Sentry hobby (free)**
  - **Why:** Error monitoring. AI can investigate exceptions from cron jobs. Production currently has 0 errors but we'll need this before traffic scales.
  - **GlitchTip option (recommended, fully OSS):** glitchtip.com — Sentry-compatible API, generous free tier.
  - **Sentry option:** sentry.io — free for 1 dev, 5k errors/mo.
  - **Add as:** `SENTRY_DSN` (works with both — we already have `@sentry/nextjs` installed).

- [ ] **GitHub fine-grained PAT — add `Contents: Read+Write` + `Pull Requests: Read+Write`**
  - **Why:** Lets me open PRs directly when I spot a fix (cron failures, lint errors, dependency bumps).
  - **How:** github.com/settings/tokens?type=beta → new fine-grained token → `ohjustadam/ikratom` repo → set permissions → copy token.
  - **Add as:** Secret `IKRATOM_BOT_TOKEN` in github.com/ohjustadam/ikratom/settings/secrets/actions

### Stance review (high-leverage manual work, ~30 min)

- [ ] **Visit `/admin/stance?state=NY`** and review the 153 AI-drafted legislator stances.
  - Most should be confirmed as-is (the AI was conservative — 82 are flagged "unknown" honestly).
  - Focus on the **8 champions and 16 hostile** — those are the actor-level intelligence. Confirm or flip them based on what you know.
  - Each row takes 5-10 seconds. Total: 25-30 min full review OR ~5 min if you just spot-check champions + hostiles.

### Other states' stance work (after NY is green)
- [ ] **Spot-check** `/admin/stance?state=FL` / `?state=TX` / etc. — priority states have AI drafts; same review pattern as NY but lower volume.

### Home page A/B/C pick (5 min)

- [ ] **Visit `/home-a` / `/home-b` / `/home-c`** and pick the one to make canonical homepage. Currently none is the default landing.

### PWA install test (5 min on your phone)

- [ ] **Open `https://www.ikratom.org/install/android` on Android OR `/install/ios` on iPhone.**
  - Verify the app launches in standalone mode (no browser chrome).
  - Verify push notifications work (test from your `/account/security` page).

### Cloudflare R2 (10 min)
- [ ] **Sign up for Cloudflare R2** (free tier: 10GB storage + 1M class-A operations / mo).
- [ ] **Add `R2_*` env vars** per `src/lib/r2.ts` TODO.
  - Activates in-app video uploads for the library / story-submission flow.

### Salt Lake City kratom summit context (high-priority intel gap, owner-only)
- [ ] **Provide:** who organized the summit, who paid for venue, attendee list, payment-host relationship. Currently the registry has Vernon Jones + Curt Bramble + your testimony as the only references and this is the single owner-testimony-only line item across 34 actors. Even a public press release or sponsor list would let me drop the "owner testimony" disclaimer.

---

## ✅ Done (since last refresh)

- [x] ~~OPENFEC_API_KEY in GitHub Actions secrets~~ — set 2026-05-14. Federal donor pipeline lit up. 257 legislators have donor profiles.
- [x] ~~Vercel + PostHog + Supabase + RTK MCPs connected~~ — done 2026-05-13/14.
- [x] ~~Auto-merge enabled~~ — blocked by GitHub plan (private + Free tier requires Pro for auto-merge). Decision: skip on cost. We use polling-merge pattern instead.
- [x] ~~Tightened repo settings via `gh api`~~ — `delete_branch_on_merge`, `squash_merge_commit_title=PR_TITLE`, `squash_merge_commit_message=PR_BODY` all flipped.
- [x] ~~Migration 0123 (`bills.current_committee_name`) applied + backfilled~~.
- [x] ~~Migration 0124 (news TV-callsign cleanup)~~ — 78 dirty titles cleaned.
- [x] ~~Migration 0125 (`lobbying_filings` table)~~ — 131 LDA filings indexed.

---

## 🚫 OpenSecrets — discontinued (was on old todo list)

OpenSecrets discontinued their free API on April 15, 2025. The old TODO entry was stale. We bypassed via:
- **Senate LDA** (no auth required) — federal lobbying disclosures
- **ProPublica Nonprofit Explorer** (no auth) — IRS 990 financials on AKA + GKC
- **OpenFEC direct** — corporate PAC tracking + employer-name categorization
- Combined, these give us the structural data OpenSecrets used to provide.

---

## 🟡 Future paid items (don't buy yet — bookmark for when revenue starts)

| Service | Cost | Free workaround in place today |
|---|---|---|
| **GitHub Pro** | $4/mo | Auto-merge would save ~3min/PR. Polling-merge works fine; skip. |
| **Browserbase** ($39/mo) | Cloudflare-bypass scraping at scale | Use **Claude in Chrome MCP** for the 4 TLS-blocked BoP states. Slower but works. **Skyvern** is the OSS self-host alternative if needed. |
| **Tavily Pro** ($30/mo) | Focused web search | Free 1000-call tier or fallback to Brave Search API. |
| **Anthropic API direct** ($5+ credits) | Claude Sonnet for high-stakes work | Currently routed via Gemini/Groq/Cerebras — works well. |
| **Twilio** (~$0.01/min) | Server-side phone-call infra | `tel:` + Web Speech API works for 80% of users. Defer. |
| **Vercel Pro** ($20/mo) | Sub-daily cron + larger build limits | Hobby + GitHub Actions sub-daily cron — fine. |

---

## What I (Claude) cannot do via my access controls

Documented so you know exactly what requires your hands:

**Things I cannot do at all:**
- Create accounts on services on your behalf (Twilio, Browserbase, Sentry, GlitchTip, PostHog Cloud, etc.) — service ToS requires the human to sign up.
- Add new environment variables to Vercel deployment — you paste them via the Vercel dashboard. (GitHub Actions secrets I CAN set via `gh secret set` if you provide the value.)
- Configure paid subscriptions, accept Terms of Service, or input credit cards.
- Configure Vercel cron schedules or project settings via UI (must use code).
- Send phone calls, SMS, or emails from your accounts (we use `mailto:` and `tel:` deep links so YOUR client sends them).

**Things I cannot do efficiently / cleanly:**
- Scrape Cloudflare-protected sites at scale (need Browserbase OR more time-consuming Skyvern self-host). The Claude in Chrome MCP works one-by-one.
- Generate AI content from providers we don't have free-tier access to (need a key first).
- Self-host services that need a server (we have Vercel + GitHub Actions — no general-purpose VM unless you provision one).

**Things I CAN do that you should know about:**
- Read/write/delete any file in the repo.
- Run scripts in a sandboxed bash with read/write filesystem access.
- Apply Supabase migrations via your `npm run db:push` (you authorized it once and it ran successfully).
- Generate AI text via the multi-provider router (Gemini/Groq/Cerebras/Mistral/Cloudflare/Ollama).
- Use Vercel MCP to read deploy logs + runtime errors.
- Use PostHog MCP to query analytics once your prod env has the key.
- Use Supabase MCP for direct DB queries / schema reads.
- Open PRs; merge after CI passes via `gh pr merge --squash --delete-branch`.
- Set GitHub Actions secrets via `gh secret set` (when you provide the secret).

---

Last updated: 2026-05-14 — by Claude after the consolidation push.
