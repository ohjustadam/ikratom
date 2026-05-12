import { MermaidLoader } from "./MermaidLoader";

export const metadata = {
  title: "iKratom · architecture & vision",
  description:
    "Public technical overview — sources, AI pipeline, user journey, vision. Built for partners + investors + developers.",
  robots: { index: false, follow: false },
};

/**
 * /pitch — investor + developer-facing one-pager.
 *
 * Renders the same Mermaid diagrams as ARCHITECTURE_PUBLIC.md plus a
 * narrative arc designed for someone seeing the platform for the first
 * time: numbers → pipeline → AI → threat thesis → roadmap → ask.
 *
 * Noindex via metadata.robots so it doesn't compete with the marketing
 * surfaces. Owners share the URL directly.
 *
 * Print-friendly: every section is page-break-aware so Chrome's
 * "Save as PDF" produces a clean deck.
 */
export default function PitchPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 text-zinc-100 sm:px-6 lg:px-8 print:max-w-none print:py-0">
      <MermaidLoader />

      {/* ────────────────────────────────────────────────────────── */}
      <Slide hero>
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          iKratom · 2026
        </p>
        <h1 className="mt-3 text-5xl font-bold leading-tight sm:text-6xl">
          The advocate&apos;s toolbelt
        </h1>
        <p className="mt-4 max-w-3xl text-lg text-zinc-300">
          A nonpartisan civic-action platform that turns hours of legislative
          tracking, rep outreach, and rule-change watching into minutes a day —
          with one-click actions backed by real-time data from every U.S. state.
        </p>
        <p className="mt-2 max-w-3xl text-base text-zinc-400">
          The operational backbone for an unfunded, distributed, mostly-volunteer
          advocacy community defending a botanical under simultaneous administrative,
          legislative, and cultural pressure.
        </p>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip n="50+DC" l="states monitored" />
          <StatChip n="340" l="active bills tracked" />
          <StatChip n="51" l="BoP surfaces daily" />
          <StatChip n="5,482" l="BoP findings logged" />
          <StatChip n="1,049" l="kratom news verified" />
          <StatChip n="8,273" l="legislators on file" />
          <StatChip n="5+" l="AI providers" />
          <StatChip n="1-click" l="legislator emails" />
        </ul>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>The problem</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Three attack vectors. One advocacy community.</h2>
        <p className="mt-4 text-zinc-300">
          Kratom faces simultaneous pressure on three fronts. Today an average
          advocate catches one of them — late — from local news.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Card emoji="🏛" title="Legislative" body="State + federal bills move fast. Companion bills + last-minute amendments routinely slip past one-source tracking." />
          <Card emoji="📋" title="Administrative" body="State Boards of Pharmacy can schedule a substance via rulemaking — without a single floor vote. NC has done it. Others have tried." />
          <Card emoji="📰" title="Cultural" body="Coordinated 'gas-station heroin' framing in syndicated coverage shapes public + legislator opinion before bills even drop." />
        </div>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>The thesis</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Cross-correlate all three. Mobilize within hours, not weeks.</h2>
        <p className="mt-4 text-zinc-300">
          The platform&apos;s defensible position is data-pipeline depth: 51 state BoP
          surfaces scraped daily, 50-state bill tracking with multi-layer AI fact-check,
          per-state news classification, all stitched into one feed. When a single
          state moves on all three vectors in one week, the alarm fires the same day.
        </p>
        <Mermaid>{`flowchart LR
  T1[🏛 Legislative] --> P[iKratom pipeline]
  T2[📋 Administrative] --> P
  T3[📰 Cultural] --> P
  P --> X[Cross-correlation:<br/>same state, same week,<br/>same substance, same actors?]
  X -->|yes| EMERGE[Emergency-class alert<br/>+ auto-campaign]
  X -->|no| MONITOR[Standard tracking]
  EMERGE --> ADVOC[Advocates mobilized<br/>within hours]`}</Mermaid>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>System architecture</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Sources → AI pipeline → user surfaces</h2>
        <Mermaid>{`flowchart TB
  classDef src fill:#1e3a8a,stroke:#3b82f6,color:#e0f2fe
  classDef proc fill:#065f46,stroke:#10b981,color:#d1fae5
  classDef surf fill:#7c2d12,stroke:#f59e0b,color:#fef3c7

  S["📥 Sources · 8+<br/>OpenStates · LegiScan · Google News · 51 state BoPs · Civic · Census · OpenFEC · user tips"]:::src
  P1["⚙️ Ingest + dedupe"]:::proc
  P2["🧠 AI router · 5 providers<br/>classify · summarize · fact-check"]:::proc
  P3["🔗 Cross-correlate by state<br/>bills ↔ BoP ↔ news"]:::proc
  P4["🚨 Auto-alerts + auto-campaigns"]:::proc
  U1["📡 Live pulse feed"]:::surf
  U2["🎛️ Personal dashboard"]:::surf
  U3["🔔 Push · Discord · email"]:::surf

  S --> P1 --> P2 --> P3 --> P4
  P4 --> U1
  P4 --> U2
  P4 --> U3`}</Mermaid>
        <p className="mt-4 text-sm text-zinc-400">
          One pipeline. Eight categories of sources flow through a single
          processing spine to three delivery surfaces — no per-source branching
          for an investor or developer to memorize.
        </p>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>AI infrastructure</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Multi-provider router. Free-tier first.</h2>
        <p className="mt-4 text-zinc-300">
          5 commercial LLM providers + local Ollama. Each job picks the right model
          for the right cost/latency/capability tradeoff. ~80 Gemini grounded calls
          per day = well under any one provider&apos;s free tier.
        </p>
        <Mermaid>{`flowchart TB
  task[AI job arrives] --> router{Router}
  router -->|fast structured| groq[Groq · Llama 3.3 70B]
  router -->|bulk + cheap| cerebras[Cerebras · Llama 3.3 70B]
  router -->|grounded fact-check| gemini[Gemini Flash 2.5<br/>+ Google Search]
  router -->|tone + narrative| mistral[Mistral Small]
  router -->|edge-distributed| cf[Cloudflare Workers AI]
  router -->|local · private| ollama[Ollama · Llama 3.1 8B]`}</Mermaid>
        <p className="mt-4 text-sm text-zinc-400">
          Used for: bill summary &amp; relevance · BoP finding classification ·
          bill-status fact-check · news scoring · local-rep AI-suggest · translation cache (6 locales).
        </p>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>BoP early-warning pipeline</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Watching the administrative path to a ban.</h2>
        <p className="mt-4 text-zinc-300">
          Three classifier layers — instant regex on titles, daily PDF extraction
          for buried content, AI-grounded verification with Google Search. When
          all three agree on hostile + confident, an alert fans out to advocates
          automatically.
        </p>
        <Mermaid>{`flowchart TB
  start([Daily cron · 51 sources]) --> adapt{Adapter}
  adapt -->|47 reachable| nodef[Node fetch · Chrome headers]
  adapt -->|4 TLS-blocked| pw[Playwright Chromium<br/>via GitHub Actions]
  nodef --> findings[bop_findings table]
  pw --> findings
  findings --> pdf[Layer 1.5:<br/>PDF agenda parsing]
  pdf --> regex[Layer 1: Regex classifier]
  regex --> ai[Layer 2: Gemini grounded re-classify]
  ai -->|conf ≥0.85 + hostile + 2-signal| autoemit[Auto policy_alert]
  ai -->|otherwise| admin_notify[Admin triage push]`}</Mermaid>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>User journey</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Sign-up to action in under 60 seconds.</h2>
        <Mermaid>{`sequenceDiagram
    participant U as User
    participant W as iKratom
    participant L as Legislator

    U->>W: Sign up via personal invite link
    W->>W: Onboarding · class + where + stake + alerts
    W->>W: Address → Census → districts → matched reps
    W-->>U: Dashboard ready · active campaigns shown
    U->>W: Open hostile-bill campaign
    W->>W: AI personalizes from user's stake
    U->>L: 1-click send via mailto / Gmail OAuth
    W->>W: Logged · streak bumps · referrer credited
    W-->>U: Push notification when bill status changes`}</Mermaid>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>Defensibility</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Moats</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card emoji="📡" title="Data pipeline depth" body="51 BoP sources + 50-state bills + per-state news + multi-layer AI fact-check + cross-referencing. Genuinely hard to replicate from scratch. Months of cron-pipeline tuning baked in." />
          <Card emoji="🔗" title="Attribution network effect" body="Every user has a personal invite link with funnel tracking (joined → action). Organic growth without paid acquisition. Each leader's recruits become their measured impact." />
          <Card emoji="🏛" title="Domain-specific AI" body="The classifier ensemble (regex + grounded LLM + PDF parsing) is tuned for kratom-class substances. Same pattern generalizes to any embattled botanical." />
          <Card emoji="🤝" title="Nonpartisan stance" body="Independent of any existing kratom advocacy org. The platform is the tool, not a faction — which is why every faction can use it." />
        </div>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>Tech stack</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Modern, secure, free-tier-sustainable.</h2>
        <Mermaid>{`flowchart TB
  subgraph FRONT["Frontend"]
    F1[Next.js 16 · App Router]
    F2[TypeScript strict]
    F3[Tailwind v4]
    F4[PWA installable · iOS + Android + desktop]
  end
  subgraph BACK["Backend"]
    B1[Supabase Postgres + Auth + Realtime + RLS]
    B2[Service-role isolation · audit-logged]
    B3[Postgres triggers for cross-table events]
  end
  subgraph INFRA["Hosting + ops"]
    I1[Vercel · edge + cron]
    I2[GitHub Actions · hourly + daily]
    I3[Cloudflare R2 · video storage]
    I4[Sentry · errors]
    I5[PostHog · product analytics]
  end
  subgraph SEC["Security"]
    S1[CSP + HSTS + XFO + Permissions-Policy]
    S2[SSRF defense · admin URL inputs]
    S3[MFA + backup codes + trusted devices]
    S4[Rate limits · 11 user-facing surfaces]
    S5[E2E libsodium · DMs]
    S6[Audit log tamper-proof DB triggers]
  end
  FRONT --> BACK
  BACK --> INFRA`}</Mermaid>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>Roadmap</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Where this goes next.</h2>
        <Mermaid>{`gantt
    title iKratom — current + forward
    dateFormat YYYY-MM
    axisFormat %b '%y
    section Shipped (v1)
    Core advocacy platform        :done, p1, 2025-08, 6M
    Multi-state bill tracking     :done, p2, 2025-09, 5M
    AI router + enrichment        :done, p3, 2025-10, 4M
    Forum + chat lounge           :done, p4, 2025-11, 3M
    BoP early-warning system      :done, p5, 2026-04, 1M
    Invite + attribution funnel   :done, p6, 2026-05, 1M
    PWA installable               :done, p7, 2026-05, 1M
    section In progress
    App store listings            :active, q1, 2026-05, 2M
    Per-state BoP custom adapters :q2, after q1, 1M
    Headless-browser service      :q3, after q2, 1M
    section v2 planned
    Medical-pro recruitment       :v1, 2026-07, 3M
    AI personalization full       :v2, after v1, 2M
    Native iOS push               :v3, 2026-08, 2M
    Coalition tooling (multi-org) :v4, 2026-10, 3M
    section v3 vision
    Multi-substance expansion     :w1, 2027-01, 6M
    International advocacy        :w2, after w1, 6M`}</Mermaid>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>By the numbers, today</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Production scale right now.</h2>
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <BigStat label="Public tables under RLS" value="62/62" />
          <BigStat label="Migrations applied" value="100+" />
          <BigStat label="Production deploys/month" value="30+" />
          <BigStat label="BoP sources reachable" value="51 of 51" />
          <BigStat label="Free-tier APIs integrated" value="8+" />
          <BigStat label="Share platforms supported" value="11" />
        </div>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide>
        <Eyebrow>Why now</Eyebrow>
        <h2 className="mt-2 text-3xl font-bold">Three pressures converging.</h2>
        <div className="mt-6 space-y-4 text-zinc-300">
          <p>
            <strong className="text-emerald-300">1. Administrative regulatory drift.</strong>{" "}
            State BoPs move on emerging substances faster than legislatures, with less public visibility. Without continuous monitoring, advocates find out the week a rule takes effect.
          </p>
          <p>
            <strong className="text-emerald-300">2. AI-enabled tracking finally affordable.</strong>{" "}
            Free-tier LLM access (Gemini grounding, Groq, Cerebras) means fact-checking 50 states&apos; bill statuses every day costs $0. Five years ago this took a team of analysts.
          </p>
          <p>
            <strong className="text-emerald-300">3. The friction floor matters more.</strong>{" "}
            Users will tap a button. They won&apos;t look up their rep, draft an email, find an address, format it correctly. iKratom collapses that workflow to one tap.
          </p>
        </div>
      </Slide>

      {/* ────────────────────────────────────────────────────────── */}
      <Slide hero>
        <Eyebrow>Ask</Eyebrow>
        <h2 className="mt-2 text-4xl font-bold">Where help would compound.</h2>
        <ul className="mt-6 space-y-3 text-lg text-zinc-300">
          <li>📱 <strong className="text-emerald-300">App store sponsorship</strong> — $25 (Google) + $99/year (Apple). Tooling is built; just the fees.</li>
          <li>🤖 <strong className="text-emerald-300">Headless-browser hosting</strong> — for the 4 TLS-blocked BoP states. Browserbase or similar free tier likely sufficient.</li>
          <li>📰 <strong className="text-emerald-300">PR + earned media</strong> — to introduce the platform to advocates who don&apos;t know it exists. 90%+ growth lever vs. paid acquisition.</li>
          <li>🧑‍💻 <strong className="text-emerald-300">A second engineer</strong> — to take any specialty surface (medical recruitment, v2 personalization, native mobile push). One operator + Claude built this; the second human doubles output.</li>
        </ul>
        <p className="mt-8 text-xs text-zinc-500">
          ohjustadam@proton.me · github.com/ohjustadam · this page: ikratom.org/pitch
        </p>
      </Slide>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Layout primitives
// ─────────────────────────────────────────────────────────────────

function Slide({ children, hero }: { children: React.ReactNode; hero?: boolean }) {
  return (
    <section
      className={`mb-16 break-inside-avoid border-b border-zinc-800 pb-12 last:border-b-0 last:pb-0 print:break-after-page print:pb-8 ${
        hero ? "min-h-[60vh]" : ""
      }`}
    >
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
      {children}
    </p>
  );
}

function StatChip({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-2xl font-bold text-zinc-100">{n}</p>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{l}</p>
    </div>
  );
}

function BigStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
      <p className="text-3xl font-bold text-emerald-300">{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{label}</p>
    </div>
  );
}

function Card({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5">
      <div className="flex items-baseline gap-2">
        <span aria-hidden className="text-xl">{emoji}</span>
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-zinc-400">{body}</p>
    </div>
  );
}

/**
 * Mermaid diagram renderer. The chart string goes into a <pre class="mermaid">
 * which the client-side MermaidLoader picks up and turns into SVG. Renders as
 * plain text if JS is off — still useful as alt text for screen readers.
 */
function Mermaid({ children }: { children: string }) {
  return (
    <div className="my-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <pre className="mermaid text-zinc-100">{children}</pre>
    </div>
  );
}
