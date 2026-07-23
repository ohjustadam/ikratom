import Link from "next/link";
import { getContent } from "@/lib/editable-content";

// Static + revalidate (2026-07-23): editorial content, identical for everyone.
export const revalidate = 3600;

export const metadata = {
  title: "Support iKratom — keep the advocate's toolbelt free + independent",
  description:
    "iKratom is a free, nonpartisan, ad-free advocacy platform built by one person. Small recurring donations keep it running, independent, and beholden to nothing but the advocate.",
};

/**
 * /support — donation + transparency page.
 *
 * Strategic posture (set in code so future edits go through PR):
 *   1. Everything stays FREE. No paywalls. No "premium" intel.
 *      The integrity of nonpartisan independence is incompatible with
 *      gating advocacy tools behind a subscription.
 *   2. Donations are a SUPPORT system — pay-what-you-want recurring
 *      to keep the platform running, the maintainer caffeinated, and
 *      the data sources funded. Not a quid-pro-quo for features.
 *   3. RADICAL TRANSPARENCY on what the money goes to. The breakdown
 *      below is literal: API costs, hosting, time. No "thank you tier"
 *      that buys access.
 *
 * The tile breakdown below is editorial — edit the LADDER array to
 * change visible milestones. Numbers reflect actual monthly costs
 * + reasonable maintainer compensation as the project scales.
 */

const LADDER: Array<{
  amount: number;
  label: string;
  unlocks: string;
  realCost: string;
  visual: string;
}> = [
  {
    amount: 5,
    label: "Cup of coffee",
    unlocks: "Covers one day of API calls (Gemini grounding, OpenAI evals, PubMed sync).",
    realCost: "Actual: ~$3–6/day in AI + sync costs across all states",
    visual: "☕",
  },
  {
    amount: 25,
    label: "One state syncs for a month",
    unlocks: "Keeps one state's news + bills + BoP + legislator data flowing daily for ~30 days.",
    realCost: "Actual: ~$15–25/state/month including news classification + alert push",
    visual: "🗺️",
  },
  {
    amount: 100,
    label: "Federal intel layer for a month",
    unlocks: "Senate LDA lobbying sync, OpenFEC donor pulls, USAspending awards, court cases, federal rulemaking — the federal money-flow stack.",
    realCost: "Actual: ~$80–120/month for the federal data layer",
    visual: "🏛️",
  },
  {
    amount: 500,
    label: "All 50 states for a month",
    unlocks: "Full national sync — every bill, every roll call, every alert, every legislator, every operation detection cycle. The whole pipeline keeps the platform alive coast-to-coast.",
    realCost: "Actual: ~$400–600/month covers the full national operational cost",
    visual: "🇺🇸",
  },
];

const IMPACT: Array<{ title: string; bullets: string[] }> = [
  {
    title: "What your donation literally funds",
    bullets: [
      "API costs (Anthropic, Gemini, OpenAI) — AI-classifying news, drafting stances, evaluating research papers",
      "Vercel hosting + GitHub Actions runners for ~40 daily background jobs",
      "Supabase database + storage + auth (free tier today; will outgrow as user count climbs)",
      "Domain + email + ancillary services",
      "Maintainer time — the project is currently solo-built and unpaid",
    ],
  },
  {
    title: "What it does NOT fund",
    bullets: [
      "Any paid lobbying activity. iKratom is informational, never a registered lobbyist.",
      "Any political party, candidate, or campaign committee.",
      "Any kratom industry org (AKA, GKC, BEA, MAC, HART) — iKratom is independent of all of them.",
      "Anonymous donor-routed influence. Donations are visible to the maintainer; we may publish an aggregate transparency report.",
    ],
  },
  {
    title: "Why this matters for integrity",
    bullets: [
      "The platform is nonpartisan and beholden to nothing. That posture is only credible if we refuse industry money.",
      "If a future kratom-industry org offers a $50k grant, we will decline. The cost of capture is higher than the cost of being underfunded.",
      "Many small donations from advocates is the only funding source that preserves the platform's independence.",
    ],
  },
];

const ROADMAP: Array<{ goal: string; cost: string; description: string }> = [
  {
    goal: "Daily push delivery",
    cost: "$200 one-time",
    description: "Cron-fired web-push for each user's morning brief. Currently the brief is pull-only; this makes it push.",
  },
  {
    goal: "Bill ↔ research cross-reference",
    cost: "$300 one-time + $30/mo",
    description: "Smart-brain integration: every bill's text scanned against the 449-paper research library to surface 'this bill is evidence-aligned' vs 'this bill ignores X studies'.",
  },
  {
    goal: "SMS alert tier",
    cost: "$50/mo at scale",
    description: "For critical alerts (final passage votes, emergency BoP rules) — SMS via Twilio for opted-in advocates in affected states.",
  },
  {
    goal: "Verified-constituent layer",
    cost: "$500 one-time + $40/mo",
    description: "Address-verified send signal — legislators triage messages from verified constituents differently. Major impact uplift per send.",
  },
  {
    goal: "Coalition contact log + activity feed",
    cost: "$200 one-time",
    description: "v2 of the Coalition Layer — members see who in their team has contacted which legislator, with privacy controls.",
  },
];

export default async function SupportPage() {
  const annualTotal = 500 * 12;

  // Admin-editable intro paragraph. The fallback below is the
  // source of truth for what visitors see when no override is set.
  // Edit live at /admin/content/support.intro from any device.
  const intro = await getContent(
    "support.intro",
    "iKratom is a free, nonpartisan, ad-free advocacy platform. No paywall. No \"premium\" intel. No industry sponsorship. Every feature stays open to every advocate — forever.",
  );
  // Donation-channel CTA — admin updates this when Open Collective
  // / GitHub Sponsors goes live.
  const ctaBanner = await getContent(
    "support.cta_banner",
    "Open Collective + GitHub Sponsors planned · transparent ledger · no industry money accepted",
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Support
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">
          Keep the advocate&apos;s toolbelt free + independent.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-zinc-300">
          {intro}
        </p>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400">
          That posture only works if a lot of small donors keep the lights on. The breakdown
          below is literal — what each contribution actually covers in API costs, hosting,
          and maintainer time.
        </p>
      </header>

      {/* Donation ladder — visual cost-to-impact mapping */}
      <section className="mb-12">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-emerald-300">
          What your contribution unlocks
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {LADDER.map((t) => (
            <li
              key={t.amount}
              className="rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5 transition hover:border-emerald-500"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-3xl">{t.visual}</span>
                <div>
                  <div className="text-3xl font-bold text-emerald-300">
                    ${t.amount}
                    <span className="ml-1 text-xs font-normal text-zinc-500">/ one-time or monthly</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-400">{t.label}</div>
                </div>
              </div>
              <p className="mt-3 text-sm text-zinc-200">{t.unlocks}</p>
              <p className="mt-2 text-[10px] italic text-zinc-500">{t.realCost}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] text-zinc-500">
          A sustaining base of 20 advocates at $25/mo = ${20 * 25 * 12}/year. That fully covers the federal intel layer + the news + alert pipeline.
          100 advocates at $25/mo = ${100 * 25 * 12}/year — full national operational coverage with budget left for v2 features.
        </p>
      </section>

      {/* Donation CTA placeholder — replaced once Open Collective / Stripe set up */}
      <section className="mb-12 rounded-lg border-2 border-emerald-500 bg-emerald-950/20 p-6 text-center">
        <p className="text-xs uppercase tracking-wider text-emerald-300">Donations are launching soon</p>
        <p className="mt-2 text-lg font-semibold text-emerald-100">
          {ctaBanner}
        </p>
        <p className="mt-3 text-sm text-zinc-300">
          Watch this page — or{" "}
          <Link href="/login" className="font-semibold text-emerald-400 underline">
            sign up
          </Link>{" "}
          and you&apos;ll be notified when the donation channel opens.
        </p>
      </section>

      {/* Impact transparency triple */}
      <section className="mb-12 grid gap-4 sm:grid-cols-3">
        {IMPACT.map((b) => (
          <div key={b.title} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">{b.title}</h3>
            <ul className="mt-2 space-y-1.5 text-[11px] text-zinc-400">
              {b.bullets.map((bb) => (
                <li key={bb} className="flex gap-1.5">
                  <span className="text-zinc-600">·</span>
                  <span>{bb}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Funded roadmap */}
      <section className="mb-12">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">
          What we build next, by funding milestone
        </h2>
        <p className="mb-4 max-w-2xl text-[12px] text-zinc-400">
          Concrete features that ship when funding clears the cost bar. No vaporware — each item below has a defined scope and a defined cost.
        </p>
        <ul className="space-y-2">
          {ROADMAP.map((r, i) => (
            <li key={r.goal} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-zinc-50">
                  Milestone {i + 1}
                </span>
                <span className="font-semibold text-zinc-100">{r.goal}</span>
                <span className="ml-auto rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                  {r.cost}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">{r.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Pillars */}
      <section className="mb-12 rounded-lg border border-amber-700/40 bg-amber-950/10 p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-amber-300">
          Our funding pillars (the &quot;will-never-budge&quot; list)
        </h2>
        <ol className="mt-3 space-y-2 text-sm text-zinc-200">
          <li>
            <strong className="text-amber-200">1. Everything stays free.</strong>{" "}
            No tool, no intel, no campaign action is ever paywalled.
          </li>
          <li>
            <strong className="text-amber-200">2. No industry money.</strong>{" "}
            We will never accept funding from AKA, GKC, BEA, MAC, HART, or any kratom company, lobbying firm, or political committee. Stated cap: $0.
          </li>
          <li>
            <strong className="text-amber-200">3. Transparent ledger.</strong>{" "}
            We aim to publish a quarterly transparency report — total donations received, expenses paid, time invested. Donors stay anonymous unless they opt in to public listing.
          </li>
          <li>
            <strong className="text-amber-200">4. Open source.</strong>{" "}
            The platform code is the platform; advocates can fork it, run their own copy, audit the algorithms. Funding doesn&apos;t buy proprietary access.
          </li>
        </ol>
      </section>

      <footer className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-[11px] text-zinc-500">
        <p>
          Questions about the funding model? Email{" "}
          <a href="mailto:hello@ikratom.org" className="text-emerald-400 hover:underline">
            hello@ikratom.org
          </a>
          . If you&apos;re an advocate organization that wants to underwrite a specific feature (e.g. &quot;our 501(c)(3) sponsors the SMS layer&quot;), we&apos;ll publish the relationship transparently and decline anything that compromises nonpartisan independence.
        </p>
      </footer>
    </div>
  );
}
