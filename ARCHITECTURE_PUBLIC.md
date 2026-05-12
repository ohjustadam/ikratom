# iKratom — Architecture, Capability Surface & Vision

> **Public technical overview.** Safe to share with developers, investors, potential partners.
> Internal security details, env vars, project IDs, and proprietary thresholds excluded.
> Last updated: 2026-05-12.

---

## What it is in one line

**iKratom is the advocate's toolbelt** — a nonpartisan civic-action platform that turns hours of legislative tracking, rep outreach, and rule-change watching into minutes a day, with one-click actions backed by real-time data from every U.S. state.

It's the operational backbone for an unfunded, distributed, mostly-volunteer advocacy community defending a botanical that's under simultaneous administrative + legislative + cultural pressure.

---

## Numbers at a glance

| | Coverage |
|---|---|
| U.S. states monitored (legislative + regulatory) | **50 + DC + federal** |
| State Board of Pharmacy surfaces scraped daily | **51** (47 via Node fetch, 4 via headless Chromium) |
| AI providers in the routing layer | **5** (Gemini, Groq, Cerebras, Mistral, Cloudflare AI) + local Ollama |
| Free-tier APIs integrated | **8+** (OpenStates, LegiScan, Google Civic, Census, HIBP, Resend, etc.) |
| User actions per legislator email | **1 click** |
| End-to-end encrypted feature | **Direct messages** (libsodium / Curve25519 + XChaCha20-Poly1305) |
| Migrations applied to schema | **102+** |
| Production deploys this month | **30+** (Vercel CI) |
| Tables under Row Level Security | **62 of 62** in `public` schema |

---

## System architecture — the 10,000-ft view

```mermaid
flowchart LR
  subgraph SOURCES["📥 Data sources"]
    A1[OpenStates API<br/>bill catalog]
    A2[LegiScan API<br/>bill verification]
    A3[Google News RSS<br/>per state]
    A4[State BoP websites<br/>51 surfaces]
    A5[Google Civic API<br/>address → reps]
    A6[Census Geocoding<br/>districts]
    A7[OpenFEC<br/>donor data]
    A8[User submissions<br/>tips / stories / forum]
  end

  subgraph PROCESS["⚙️ Processing pipeline"]
    B1[Ingest + dedupe]
    B2[AI enrichment<br/>multi-provider router]
    B3[Classification<br/>regex + AI grounded]
    B4[Cross-reference<br/>bills ↔ news ↔ BoP]
    B5[Auto-alerts<br/>policy_alerts table]
    B6[Auto-campaigns<br/>from hostile bills]
  end

  subgraph STORE["💾 Persistence"]
    C1[Supabase Postgres<br/>RLS on every table]
    C2[Cloudflare R2<br/>video uploads]
  end

  subgraph SURFACES["📤 User-facing surfaces"]
    D1[/pulse — live feed/]
    D2[/dashboard — cockpit/]
    D3[/bills, /legislators/]
    D4[/bop-watch/]
    D5[Push notifications<br/>web + iOS + Android]
    D6[Discord webhooks<br/>partner channels]
    D7[Embed widget<br/>partner sites]
  end

  SOURCES --> PROCESS
  PROCESS --> STORE
  STORE --> SURFACES
  SURFACES -.user actions.-> A8
```

---

## Data ingestion pipeline

### Bills (legislative track)

```mermaid
flowchart TB
  start([Hourly + daily cron])
  start --> openstates[OpenStates fetch<br/>per state]
  start --> legiscan[LegiScan fetch<br/>active anti+pro]
  openstates --> dedup[Dedupe by state+bill_number]
  legiscan --> dedup
  dedup --> enrich[AI enrichment<br/>summary + relevance + targets_natural_leaf]
  enrich --> verify[Layer 3:<br/>Gemini-grounded verification]
  verify -->|status disagrees| alert[policy_alerts:<br/>scraper_stale]
  verify -->|signed into law| critical[policy_alerts:<br/>critical severity]
  enrich -->|hostile + high confidence| autocamp[Auto-create campaign]
  autocamp --> queue[Admin review queue]
  queue --> publish[Publish to /pulse]
```

### Board of Pharmacy (administrative track — the second front)

```mermaid
flowchart TB
  start([Daily cron])
  start --> scrape{Adapter}
  scrape -->|47 sites| nodef[Node fetch + Chrome headers]
  scrape -->|4 TLS-blocked| pw[Playwright Chromium<br/>via GitHub Actions]
  nodef --> findings[bop_findings table]
  pw --> findings
  findings --> pdf[Layer 1.5:<br/>Download + parse PDFs]
  pdf --> regex[Layer 1:<br/>Regex keyword classifier<br/>kratom_direct / adjacent]
  regex --> ai[Layer 2:<br/>Gemini grounded re-classify<br/>reads linked content + cross-refs]
  ai -->|conf ≥0.85 + hostile + 2-signal| autoemit[Auto-emit policy_alert]
  ai -->|all other direct findings| admin_notify[Admin push notification]
  autoemit --> pulse[/pulse live feed]
  ai --> bop_watch[Public /bop-watch page]
  findings --> bop_watch
```

### News + intel

```mermaid
flowchart LR
  rss[Google News RSS<br/>51 scopes] --> sync[Daily sync]
  user[User intel tips<br>/alerts/submit] --> review[Admin intel queue]
  sync --> classify[AI relevance scoring]
  classify --> news[news_items table]
  review --> news
  news --> pulse[/pulse news widget]
  news --> alerts{Auto-trigger<br/>kratom_direct +<br/>high-severity?}
  alerts -->|yes| policy[policy_alerts]
  alerts -->|no| quiet[stays in /news]
```

---

## AI infrastructure

The platform uses a **multi-provider router** that picks the right LLM for each job based on cost, latency, capability, and live quota.

```mermaid
flowchart TB
  task[AI task] --> router{Router decision}
  router -->|fast structured| groq[Groq<br/>Llama 3.3 70B]
  router -->|cheap bulk| cerebras[Cerebras<br/>Llama 3.3 70B]
  router -->|grounded fact-check| gemini[Gemini Flash 2.5<br/>+ Google Search]
  router -->|narrative + tone| mistral[Mistral Small]
  router -->|edge-distributed| cf[Cloudflare Workers AI<br/>Llama 3.1 8B]
  router -->|local + private| ollama[Ollama<br/>Llama 3.1 8B]

  subgraph USES["Where AI runs in the pipeline"]
    U1[Bill summary + relevance]
    U2[Bill journey narrative]
    U3[Substance-targeting analysis<br/>natural-leaf vs synthetic-only]
    U4[BoP finding classification]
    U5[Bill status fact-check<br/>Layer 3 verification]
    U6[News relevance scoring]
    U7[Local rep AI-suggest]
    U8[Translation cache<br/>6 locales]
    U9[Campaign personalization<br/>flagged off in v1]
  end

  groq --> U1
  groq --> U6
  gemini --> U4
  gemini --> U5
  gemini --> U7
  cerebras --> U2
  cerebras --> U3
  mistral --> U8
  cf --> U6
  ollama -.local enrichment.-> U1
```

**Quota strategy**: ~80 Gemini grounded calls/day (well under 1500/day free tier), most other work routes to Groq/Cerebras free tiers. All AI jobs logged to `ai_jobs` table for cost + activity tracking on `/admin/ai-control`.

---

## User journey (signed-up advocate)

```mermaid
sequenceDiagram
    participant U as User
    participant W as Website
    participant DB as Supabase
    participant AI as AI router
    participant L as Legislator

    U->>W: Sign up via /i/CODE invite link
    W->>DB: Profile created<br/>(linked to inviter)
    U->>W: Onboarding: class / where / stake / alerts
    W->>DB: profiles populated
    Note over W: Address → Census → districts
    W->>DB: legislators matched by district
    DB-->>U: Dashboard ready<br/>(active campaigns shown)

    U->>W: Open a hostile-bill campaign
    W->>AI: Personalize email tone<br/>from user's "stake" field
    AI-->>W: Tailored email body
    U->>L: Send 1-click via mailto / Gmail OAuth
    W->>DB: campaign_actions logged
    DB->>DB: Trigger: bump action streak<br/>+ first_action_at on referrer
    DB-->>U: Push notification when bill status changes
```

---

## Features by user role

| Capability | Anon | Signed-in | Leader | Admin | Owner |
|---|:-:|:-:|:-:|:-:|:-:|
| Browse pulse / bills / news / library | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/bop-watch` early-warning view | ✓ | ✓ | ✓ | ✓ | ✓ |
| Read briefings | ✓ | ✓ | ✓ | ✓ | ✓ |
| Send 1-click campaign actions | | ✓ | ✓ | ✓ | ✓ |
| Encrypted DMs | | ✓ | ✓ | ✓ | ✓ |
| Forum participation | | ✓ | ✓ | ✓ | ✓ |
| Custom saved searches | | ✓ | ✓ | ✓ | ✓ |
| Email tone presets | | ✓ | ✓ | ✓ | ✓ |
| Personal invite link + funnel stats | | ✓ | ✓ | ✓ | ✓ |
| Submit intel tip / story | | ✓ | ✓ | ✓ | ✓ |
| Field-signup (recruit advocates in person) | | | ✓ | ✓ | ✓ |
| Author a campaign | | | ✓ | ✓ | ✓ |
| Add local officials | | | ✓ | ✓ | ✓ |
| Add library items | | | ✓ | ✓ | ✓ |
| Approve / reject pending campaigns | | | | ✓ | ✓ |
| Manual bill add | | | | ✓ | ✓ |
| Manage users + permissions | | | | ✓ | ✓ |
| Sync triggers + AI cost dashboard | | | | ✓ | ✓ |
| BoP source URL editing | | | | ✓ | ✓ |
| Emergency-mode site banner | | | | ✓ | ✓ |
| Ownership transfer | | | | | ✓ |
| Granular permission matrix (21 perms × 6 cats) | | | | | ✓ |

---

## Core capability surface

```mermaid
mindmap
  root((iKratom))
    Advocacy actions
      One-click legislator emails
      Personalized via AI<br/>tone presets
      Campaign waves<br/>scheduled batches
      Action streaks + badges
      Action audit trail
    Legislative tracking
      Every state bill<br/>OpenStates + LegiScan
      Bill journey narrative
      Substance targeting<br/>natural-leaf vs synthetic
      Sponsor + donor data
      Multi-layer fact-check
    Administrative watch
      51 state BoP surfaces<br/>scraped daily
      PDF agenda parsing
      AI-grounded classification
      Auto-emit hostile rules
      Stale-source alarm 48h
    Community
      State forums<br/>moderated + auto-flag
      Topic communities
      Live chat lounge<br/>realtime
      E2E encrypted DMs<br/>libsodium
      Stories + briefings
    Recruitment
      Per-user invite codes
      11-platform share UX
      Funnel: joined → action
      Leader field-signup
      Partner shop QR kit
    Notifications
      Web push<br/>VAPID
      Email via Resend/Brevo
      In-app inbox
      Discord webhooks<br/>partner channels
      Custom saved searches
    Privacy
      RLS on every table
      MFA + backup codes
      Audit log tamper-proof
      E2E DM encryption
      Email enumeration defense
```

---

## The threat-detection thesis

Kratom faces **three simultaneous attack vectors**. The platform watches all three and cross-correlates.

```mermaid
flowchart LR
  subgraph THREATS["Three attack vectors"]
    T1[🏛 Legislative<br/>state + federal bills]
    T2[📋 Administrative<br/>BoP rulemaking]
    T3[📰 Cultural<br/>news + media framing]
  end

  T1 --> P[iKratom pipeline]
  T2 --> P
  T3 --> P

  P --> X[Cross-correlation:<br/>same state, same week,<br/>same substance, same actors?]
  X -->|yes| EMERGE[Emergency-class<br/>policy_alert]
  X -->|no| MONITOR[Standard tracking]
  EMERGE --> ADVOC[Advocates mobilized<br/>within hours]
```

**Example**: a single state moves on ALL THREE in one week (BoP files scheduling petition, AG announces investigation, news syndicates "gas-station heroin" framing). Today: a typical advocate would catch one of the three from local news, days late. With iKratom: all three surface in one place, with one-click responses, the same day.

---

## Tech stack

```mermaid
flowchart TB
  subgraph FRONT["Frontend"]
    F1[Next.js 16 App Router<br/>TypeScript strict]
    F2[Tailwind v4]
    F3[React Server Components<br/>+ Server Actions]
    F4[PWA installable<br/>iOS + Android + desktop]
  end

  subgraph BACK["Backend"]
    B1[Supabase Postgres<br/>+ Auth + RLS + Realtime]
    B2[Service-role isolation<br/>audit-logged]
    B3[Postgres triggers<br/>for trans-state events]
  end

  subgraph INFRA["Hosting + ops"]
    I1[Vercel<br/>edge + cron]
    I2[GitHub Actions<br/>hourly + daily cron]
    I3[Cloudflare R2<br/>video storage]
    I4[Sentry<br/>error tracking]
    I5[PostHog<br/>product analytics]
  end

  subgraph SEC["Security"]
    S1[CSP + HSTS + XFO<br/>+ Permissions-Policy]
    S2[SSRF defense<br/>on admin URL inputs]
    S3[MFA + backup codes]
    S4[Rate limits<br/>11 user-facing surfaces]
    S5[E2E libsodium<br/>for DMs]
  end

  FRONT --> BACK
  BACK --> INFRA
  SEC -.applied to all.-> FRONT
  SEC -.applied to all.-> BACK
```

---

## Vision & roadmap

```mermaid
gantt
    title iKratom — current state & forward roadmap
    dateFormat YYYY-MM
    axisFormat %b '%y

    section Shipped (v1)
    Core advocacy platform        :done, p1, 2025-08, 6M
    Multi-state bill tracking     :done, p2, 2025-09, 5M
    AI router + enrichment        :done, p3, 2025-10, 4M
    Forum + chat lounge           :done, p4, 2025-11, 3M
    BoP early-warning system      :done, p5, 2026-04, 1M
    Invite friends + attribution  :done, p6, 2026-05, 1M
    PWA installable               :done, p7, 2026-05, 1M

    section In progress
    App store listings            :active, q1, 2026-05, 2M
    Per-state BoP custom adapters :q2, after q1, 1M
    Headless-browser-as-a-service :q3, after q2, 1M

    section Planned (v2)
    Medical-pro recruitment       :v1, 2026-07, 3M
    AI personalization (full)     :v2, after v1, 2M
    Native push iOS               :v3, 2026-08, 2M
    Coalition tooling (multi-org) :v4, 2026-10, 3M

    section Vision (v3)
    Multi-substance expansion     :w1, 2027-01, 6M
    International advocacy        :w2, after w1, 6M
```

---

## Why now

**Three pressures converging.**

1. **Administrative regulatory drift**: state Boards of Pharmacy are quietly moving on emerging substances faster than legislatures, with less public visibility. Without continuous monitoring, advocates find out the week a rule takes effect.

2. **AI-enabled tooling makes per-state tracking actually possible**: free-tier LLM access (Gemini grounding, Groq, Cerebras) means we can fact-check 50 states' bill statuses every day for $0. Five years ago this took a team of analysts.

3. **Civic engagement floor is collapsing**: people respond to "one tap" but not to "look up your rep + draft an email + find their address + format it correctly". The friction reduction matters more than ever.

The advocacy community for kratom is large, decentralized, and almost entirely run by unpaid volunteers. A platform that turns hours of work into minutes scales their existing energy by an order of magnitude.

---

## What this is not

- **Not partisan.** Doesn't favor any of the existing kratom advocacy orgs (AKA, GKC, BAE, MAC). The platform is a tool, not a faction.
- **Not a CRM** for advocacy orgs. It empowers individual advocates directly.
- **Not a paid SaaS.** Free-tier-only for v1; sustainable on community donations + partner shop sponsorships.
- **Not a social network.** Forum and DMs exist but the point is action, not engagement metrics.

---

## What we're asking partners + investors + developers to know

- The codebase ships **multiple production PRs per day**, with CI/CD, security headers, audit logs, RLS, MFA, and append-only audit triggers — built like a venture-scale product, run on a free-tier budget.
- The data pipeline is **defensible**: 51 state BoP sources scraped + AI-classified + cross-correlated with bill data is genuinely hard to replicate.
- The community moat is the **network effect of attribution** — every user has a personal invite link with funnel tracking, growing organically without paid acquisition.
- The vision extends past kratom — the **3-vector threat-detection pattern** (legislative + administrative + cultural) applies to any embattled botanical or supplement category.

---

_Built and maintained by one operator + Claude (AI co-developer). Codebase at: `github.com/ohjustadam/ikratom` (private until v2 launch). Investor / partner inquiries: ohjustadam@proton.me._
