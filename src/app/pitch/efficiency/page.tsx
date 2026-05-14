import Link from "next/link";
import { MermaidLoader } from "../MermaidLoader";

export const metadata = {
  title: "iKratom · API efficiency & free-tier stack",
  description: "How the platform runs free-tier-only: AI router with 7 providers + free data APIs + open-source libs. Shareable breakdown.",
  robots: { index: false, follow: false },
};

/**
 * /pitch/efficiency — shareable breakdown of the free-tier-only stack.
 *
 * Designed to be sent to a dev friend or shown to investors as proof
 * that the platform achieves commercial-grade capability on $0 monthly
 * spend (excluding Supabase Pro if/when we outgrow Free, Vercel Pro
 * similarly).
 *
 * Structure:
 *   1. Hero claim: 7-provider AI router, 12+ free data APIs, ~$0/mo
 *   2. Mermaid diagram: AI fallback chain
 *   3. Mermaid diagram: data-source map
 *   4. Side-by-side table: free choice vs commercial alternative + savings
 *   5. Honest disclosures: limits, rate caps, what we'd switch to at scale
 */
export default function EfficiencyPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 text-zinc-100 sm:px-6 lg:px-8">
      <MermaidLoader />

      <Link href="/pitch" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Pitch overview
      </Link>

      <header className="mt-2 mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ⚙ Free-tier-only stack
        </p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
          $0/mo for capabilities that normally cost $2,000+/mo
        </h1>
        <p className="mt-4 max-w-3xl text-base text-zinc-400">
          iKratom runs without paid AI, paid email, paid push, paid SMS, or
          paid headless-browser services. Every primary capability has a
          free-tier upstream and a fallback chain. This page is the
          receipt — designed to be shared with a developer friend who
          asks <em>&ldquo;how are you affording this?&rdquo;</em>
        </p>
      </header>

      {/* Top-line metrics */}
      <section className="mb-12 grid gap-3 sm:grid-cols-3">
        <Metric value="7" label="AI providers" sub="router-based fallback, $0 in steady state" />
        <Metric value="12+" label="Free data APIs" sub="LegiScan / OpenStates / PubMed / Civic / FEC / Google News / RSS / etc." />
        <Metric value="$0" label="Monthly recurring" sub="excluding free Vercel Hobby + Supabase Free" tone="emerald" />
      </section>

      {/* AI fallback chain */}
      <Section title="1. AI router — 7-provider fallback chain">
        <p className="mb-4 text-sm text-zinc-400">
          Every AI call routes through <code className="rounded bg-zinc-900 px-1 text-emerald-300">scripts/lib/ai-router.mjs</code>{" "}
          (or <code className="rounded bg-zinc-900 px-1 text-emerald-300">src/lib/ai/router.ts</code>).
          Cooldown-aware: when a provider rate-limits, the router skips it for
          ~5 minutes and tries the next. Anthropic Claude is reserved for the
          handful of stakes-critical calls (admin intel triage); everything
          else runs on free providers.
        </p>

        <pre className="mermaid mx-auto max-w-full overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
{`flowchart LR
  REQ(["AI request"]) --> R{"AI router"}
  R -->|primary, fastest| GROQ["Groq<br/>llama-3.3-70b<br/>FREE 14400 tok/min"]
  R -->|grounded search| GEM["Gemini Flash 2.5<br/>FREE 1500 req/day<br/>+ Google Search grounding"]
  R -->|fallback| CER["Cerebras<br/>llama-3.1-8b<br/>FREE 50K tok/day"]
  R -->|fallback| MIS["Mistral Small<br/>FREE tier"]
  R -->|fallback| CFW["Cloudflare Workers AI<br/>llama-3.3-70b-fp8<br/>FREE 10K/day"]
  R -->|owner machine| OLL["Ollama local<br/>llama3.1:8b<br/>$0 forever"]
  R -.->|stakes-critical only| ANT["Anthropic Claude<br/>PAID — used sparingly"]

  style GROQ fill:#10b98120,stroke:#10b981
  style GEM fill:#10b98120,stroke:#10b981
  style CER fill:#10b98120,stroke:#10b981
  style MIS fill:#10b98120,stroke:#10b981
  style CFW fill:#10b98120,stroke:#10b981
  style OLL fill:#10b98120,stroke:#10b981
  style ANT fill:#7f1d1d20,stroke:#dc2626`}
        </pre>
      </Section>

      {/* Data source map */}
      <Section title="2. Data ingestion — 12+ free APIs">
        <p className="mb-4 text-sm text-zinc-400">
          Every layer of the kratom-policy pipeline (bills, news, meetings,
          legislators, research, FB OG previews) draws from a free upstream.
        </p>

        <pre className="mermaid mx-auto max-w-full overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
{`flowchart TB
  subgraph LEGI["Legislative tracking"]
    LS["LegiScan<br/>30K req/mo FREE"]
    OS["OpenStates v3<br/>FREE w/ key"]
    BOP["State BoP sites<br/>direct HTML scrape"]
  end

  subgraph NEWS["News + verification"]
    GN["Google News RSS<br/>FREE, no key"]
    PW["Playwright (open source)<br/>resolve redirect URLs"]
  end

  subgraph CIVIC["Civic data"]
    GCI["Google Civic Info<br/>FREE"]
    FEC["OpenFEC<br/>FREE"]
    USIO["unitedstates.io<br/>OSS dataset"]
  end

  subgraph MEET["Municipal meetings"]
    CP["CivicPlus<br/>direct scrape ~3000 cities"]
    GR["Granicus<br/>direct scrape ~5000 cities"]
    LG["Legistar<br/>direct scrape ~500 cities"]
    BD["BoardDocs<br/>direct scrape ~1500 districts"]
  end

  subgraph RES["Research"]
    PUB["PubMed E-utils<br/>FREE, no key"]
  end

  subgraph SHARE["Distribution"]
    FB["Facebook Graph<br/>FREE OG cache flush"]
    VAPID["Web Push (VAPID)<br/>FREE — no Pusher/OneSignal"]
  end

  LS & OS & BOP --> DB[(Supabase Postgres<br/>FREE tier)]
  GN & PW --> DB
  GCI & FEC & USIO --> DB
  CP & GR & LG & BD --> DB
  PUB --> DB
  DB --> FB
  DB --> VAPID
  VAPID --> USER([Your phone])`}
        </pre>
      </Section>

      {/* Side-by-side savings table */}
      <Section title="3. What this would cost on a 'normal' stack">
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-left text-xs uppercase tracking-wider text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Capability</th>
                <th className="px-3 py-2 font-semibold">iKratom uses</th>
                <th className="px-3 py-2 font-semibold">Commercial alt</th>
                <th className="px-3 py-2 font-semibold text-right">Est. saved /mo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              <Row cap="Primary AI inference" us="Groq llama-3.3-70b (free 14400 tok/min)" alt="Anthropic Claude Sonnet @ $3/$15 per MTok" saved="$400-1,200" />
              <Row cap="Grounded fact-check" us="Gemini Flash 2.5 + Search (free 1500/day)" alt="Perplexity Pro API @ $5/MTok+" saved="$200-800" />
              <Row cap="Bulk classification" us="Cerebras llama-3.1-8b (free 50K/day)" alt="OpenAI GPT-4o-mini ($0.15/MTok)" saved="$50-200" />
              <Row cap="State bill tracking" us="LegiScan (free 30K/mo)" alt="LegiScan Pro / Politico Pro" saved="$300-2,500" />
              <Row cap="Per-state legislators" us="OpenStates v3 (free w/ key)" alt="ProPublica Congress API + paid scraping" saved="$0-100" />
              <Row cap="Research papers" us="PubMed E-utils (free, no key)" alt="Semantic Scholar API paid tier" saved="$50-200" />
              <Row cap="Civic / district lookup" us="Google Civic Info (free)" alt="Cicero / GeoCivic" saved="$200-500" />
              <Row cap="Push notifications" us="Web Push (VAPID, open source)" alt="OneSignal / Pusher" saved="$50-200" />
              <Row cap="Email to legislators" us="mailto: links (free, native)" alt="Resend / SendGrid transactional" saved="$50-300" />
              <Row cap="SMS invites" us="sms: links + Contact Picker API" alt="Twilio SMS" saved="$50-500" />
              <Row cap="Headless browser" us="Playwright (open source)" alt="Browserbase / Browserless cloud" saved="$50-200" />
              <Row cap="PDF text extraction" us="pdf-parse (open source)" alt="AWS Textract / GPT-4 Vision" saved="$20-150" />
              <Row cap="QR codes" us="qrcode npm package" alt="QR API services" saved="$10-50" />
              <Row cap="Realtime updates" us="Supabase Realtime (free tier)" alt="Pusher Channels / Ably" saved="$30-200" />
              <Row cap="Per-state OG images" us="next/og ImageResponse (open source)" alt="Cloudinary / Imgix" saved="$30-100" />
              <Row cap="Municipal meeting agendas" us="Direct scrape of CivicPlus/Granicus/Legistar/BoardDocs" alt="Civic Plus Pro Connect / paid procurement data" saved="$300-1,500" />
              <Row cap="iCal calendar feeds" us="Our own RFC 5545 generator (60 LOC)" alt="Calendly / Add-to-Calendar SaaS" saved="$30-200" />
              <Row cap="Hosting + cron" us="Vercel Hobby + GitHub Actions" alt="Vercel Pro + dedicated cron infra" saved="$20-100" />
              <Row cap="Database + auth" us="Supabase Free" alt="Supabase Pro / Firebase Blaze" saved="$25-200" />
              <Row cap="E2E encrypted DMs" us="libsodium (open source)" alt="Stream Chat / SendBird" saved="$300-1,000" />
            </tbody>
            <tfoot className="bg-zinc-950/60 text-sm">
              <tr>
                <td colSpan={3} className="px-3 py-2 font-bold text-emerald-300">
                  Estimated total saved per month
                </td>
                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">
                  ~$2,200 – $10,000+
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-500">
          Ranges reflect <strong>actual usage volume</strong> (low end) vs{" "}
          <strong>what we&apos;d be paying at scale</strong> (high end). The point isn&apos;t
          the dollar figure — it&apos;s that every capability has a free-tier substitute
          deliberately chosen <em>before</em> the platform was built.
        </p>
      </Section>

      {/* Honest disclosures */}
      <Section title="4. Honest disclosures — where the seams are">
        <ul className="space-y-3 text-sm text-zinc-300">
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Rate limits are real.</strong> Groq cuts off at 14,400
              tokens/min per key — fine for advocacy-scale volume, would not fit a 1M-user
              product. The fallback chain (Gemini → Cerebras → Mistral → Cloudflare) softens this
              but doesn&apos;t eliminate it.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Anthropic Claude is reserved for stakes-critical work.</strong>{" "}
              When the answer needs to be the most defensible we can produce
              (BoP rule classification, sensitive content moderation), we pay
              for Claude. That&apos;s typed clearly in <code className="rounded bg-zinc-900 px-1">src/lib/ai/router.ts</code>{" "}
              — it&apos;s not a fallback, it&apos;s a deliberate escalation.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Vercel Hobby caps daily cron at 1 run.</strong>{" "}
              We work around this by using GitHub Actions for hourly + sub-daily.
              At scale we&apos;d switch to Vercel Pro ($20/mo) for the cleaner DX.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">Supabase Free has row-count + bandwidth caps.</strong>{" "}
              Current usage is well within. Pro is $25/mo when we cross.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span aria-hidden>⚠</span>
            <span>
              <strong className="text-zinc-100">No paid email service yet.</strong>{" "}
              The mailto: model means user&apos;s default mail client opens with a
              pre-filled message — they hit send themselves. Has the side effect
              of bypassing spam filters (it&apos;s from the user, not a SaaS), but
              also caps the platform at &ldquo;letter-writing&rdquo; until we add Resend / Postmark.
            </span>
          </li>
        </ul>
      </Section>

      {/* What we'd do at scale */}
      <Section title="5. What we&apos;d switch to at 100K+ users">
        <p className="text-sm text-zinc-400">
          Once paid migration is justified by usage, the swap-outs are clean
          drop-ins because every primary call is router-shaped:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-zinc-300">
          <li>→ Vercel Pro ($20/mo) for unlimited cron + bandwidth headroom</li>
          <li>→ Supabase Pro ($25/mo) for daily backups + dedicated CPU</li>
          <li>→ Resend ($20/mo) when we ever need actual deliverable email (newsletters, password resets at scale)</li>
          <li>→ LegiScan Premium ($79/mo) only if we exceed the 30K req/mo free tier</li>
          <li>→ Anthropic Claude on a slightly larger budget for the AI router&apos;s premium tier — primary stays Groq/Gemini for cost</li>
        </ul>
        <p className="mt-3 text-sm text-zinc-400">
          Total at 100K-user scale: ~$150/mo. Versus a &ldquo;naive&rdquo; stack
          (Claude primary + Twilio + Pusher + Resend + paid LegiScan + Cloudinary + ...):
          ~$3,000–$5,000/mo. The architecture is set up so that&apos;s a tunable
          line, not a rebuild.
        </p>
      </Section>

      <div className="mt-12 rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
          Share this page
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Permalink: <code className="rounded bg-zinc-900 px-2 py-0.5 text-emerald-300">https://www.ikratom.org/pitch/efficiency</code>
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          Built for your dev friend who asks &ldquo;wait, how are you paying for all this?&rdquo;.
        </p>
        <p className="mt-3 text-xs text-zinc-400">
          Want proof the pipelines actually run? Live counts + per-cron freshness at{" "}
          <Link href="/status" className="font-semibold text-emerald-400 hover:underline">
            /status →
          </Link>
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="mb-4 text-2xl font-bold text-zinc-100">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ value, label, sub, tone = "zinc" }: {
  value: string;
  label: string;
  sub: string;
  tone?: "zinc" | "emerald";
}) {
  const toneCls = tone === "emerald"
    ? "border-emerald-700/40 bg-emerald-950/15"
    : "border-zinc-800 bg-zinc-950/40";
  return (
    <div className={`rounded-lg border p-5 ${toneCls}`}>
      <p className={`text-4xl font-bold tabular-nums ${tone === "emerald" ? "text-emerald-300" : "text-zinc-100"}`}>
        {value}
      </p>
      <p className="mt-1 text-sm font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function Row({ cap, us, alt, saved }: { cap: string; us: string; alt: string; saved: string }) {
  return (
    <tr className="hover:bg-zinc-950/40">
      <td className="px-3 py-2 font-medium text-zinc-100">{cap}</td>
      <td className="px-3 py-2 text-emerald-300">{us}</td>
      <td className="px-3 py-2 text-zinc-500">{alt}</td>
      <td className="px-3 py-2 text-right font-mono text-emerald-300">{saved}</td>
    </tr>
  );
}
