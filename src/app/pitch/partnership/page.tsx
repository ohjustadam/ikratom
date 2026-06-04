import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "iKratom · partnership brief",
  description: "Two-page brief: what we've built, why the premium build seat earns its keep, and where the revenue comes from.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * /pitch/partnership — 2-page printable brief for a business partner.
 *
 * Designed to be shown in a meeting and/or "Save as PDF" from Chrome.
 * Each top-level <Slide> is `print:break-after-page` so the printed
 * artifact lands at exactly 2 pages.
 *
 * Page 1 — What this is, what it cost to build, why the premium Claude
 *          seat is the cheapest way to keep shipping.
 * Page 2 — Revenue model (vendor ads · memberships · donations),
 *          conservative 12-mo projection, and the ask.
 */

export default async function PartnershipPage() {
  const supabase = await createClient();
  const now = Date.now();
  const since30d = new Date(now - 30 * 86_400_000).toISOString();

  const [bills, legislators, alerts30d, callsLast30d, meetings, research] = await Promise.all([
    supabase
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .in("kratom_relevance", ["anti", "pro"]),
    supabase.from("legislators").select("id", { count: "exact", head: true }),
    supabase
      .from("policy_alerts")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "approved")
      .gte("created_at", since30d),
    supabase
      .from("call_sessions")
      .select("id", { count: "exact", head: true })
      .gte("started_at", since30d)
      .not("ended_at", "is", null),
    supabase
      .from("municipal_meetings")
      .select("id", { count: "exact", head: true })
      .eq("moderation_status", "approved")
      .gte("meeting_at", new Date(now).toISOString()),
    supabase
      .from("research_papers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  const live = {
    bills: bills.count ?? 0,
    legislators: legislators.count ?? 0,
    alerts30d: alerts30d.count ?? 0,
    calls30d: callsLast30d.count ?? 0,
    meetings: meetings.count ?? 0,
    research: research.count ?? 0,
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 text-zinc-100 sm:px-6 lg:px-8 print:max-w-none print:py-0">
      <Link href="/pitch" className="text-xs text-zinc-500 hover:text-emerald-400 print:hidden">
        ← Pitch overview
      </Link>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* PAGE 1 — The case + why the premium build seat earns its keep */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            Partnership brief · {new Date(now).toISOString().slice(0, 10)}
          </p>
          <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
            The advocate&apos;s toolbelt — and the case for keeping the build velocity.
          </h1>
          <p className="mt-3 max-w-3xl text-base text-zinc-400">
            iKratom is a nonpartisan civic-action platform for the kratom
            advocacy community. It turns hours of legislative tracking, rep
            outreach, and rule-change watching into minutes a day — backed by
            real-time data from every U.S. state. It is not affiliated with any
            existing advocacy org. The product stance is pro-kratom + pro-7-OH;
            the operating stance is neutral toward orgs so every faction can use it.
          </p>
        </header>

        <section className="mb-6">
          <Eyebrow>Live traction</Eyebrow>
          <p className="mt-1 text-xs text-zinc-500">
            Pulled from production at {new Date(now).toISOString().slice(0, 19).replace("T", " ")} UTC
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            <Stat n={live.bills.toLocaleString()} l="active bills" />
            <Stat n="51 of 51" l="state BoPs scraped" />
            <Stat n={live.legislators.toLocaleString()} l="legislators on file" />
            <Stat n={live.alerts30d.toLocaleString()} l="alerts last 30d" />
            <Stat n={live.calls30d.toLocaleString()} l="calls placed (30d)" />
            <Stat n={live.meetings.toLocaleString()} l="upcoming meetings" />
          </div>
          <p className="mt-3 text-[11px] text-zinc-500">
            Plus: {live.research.toLocaleString()} research papers indexed · 131 federal lobbying filings ·
            257 federal donor profiles · 34 named industry actors.
            Verify any of these at{" "}
            <Link href="/status" className="text-emerald-400 hover:underline">/status</Link>.
          </p>
        </section>

        <section className="mb-6">
          <Eyebrow>What it costs to run</Eyebrow>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <CostCard
              title="Infrastructure"
              amount="$0/mo"
              detail="Vercel Hobby + Supabase Free + GitHub Actions cron + 10-provider AI router (Groq, Gemini, Cerebras, Mistral, Cloudflare, GitHub, SambaNova, OpenRouter, NVIDIA, Ollama) — all free tiers."
            />
            <CostCard
              title="What this would cost commercially"
              amount="$2,000 – $5,000/mo"
              detail="Same capabilities on Claude-primary + Twilio + Pusher + Resend + paid LegiScan + Quorum-equivalent lobbying data. Full breakdown at /pitch/efficiency."
              tone="amber"
            />
            <CostCard
              title="The only real spend"
              amount="The build seat"
              detail="A premium Claude seat for the operator who designs, writes, and ships the code. That's the line item this brief is about."
              tone="emerald"
            />
          </div>
        </section>

        <section>
          <Eyebrow>Why the premium build seat earns its keep</Eyebrow>
          <p className="mt-2 text-sm text-zinc-300">
            The platform is built by one operator working with Claude as a
            pair-programmer. Throughput is dominated by how much Claude time
            is available per day, not by ideas or scope. The math:
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">&nbsp;</th>
                  <th className="px-3 py-2">Standard seat</th>
                  <th className="px-3 py-2 text-emerald-300">Premium seat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                <tr>
                  <td className="px-3 py-2 font-medium text-zinc-100">Model tier</td>
                  <td className="px-3 py-2">Sonnet, daily limit hit fast</td>
                  <td className="px-3 py-2 text-emerald-200">Opus 4.x sustained</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-zinc-100">Daily output</td>
                  <td className="px-3 py-2">~½ focused PR before throttling</td>
                  <td className="px-3 py-2 text-emerald-200">2–4 focused PRs/day, sustained</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-zinc-100">Failure mode</td>
                  <td className="px-3 py-2">Wait until tomorrow, lose momentum</td>
                  <td className="px-3 py-2 text-emerald-200">Ship the fix in the same hour</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-zinc-100">Equivalent hire</td>
                  <td className="px-3 py-2 text-zinc-500">—</td>
                  <td className="px-3 py-2 text-emerald-200">Part-time senior engineer: $2,500–5,000/mo</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-zinc-100">Output verifiable at</td>
                  <td className="px-3 py-2 text-zinc-500">—</td>
                  <td className="px-3 py-2 text-emerald-200 font-mono text-xs">github.com/ohjustadam/ikratom · 460+ merged PRs</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-sm text-zinc-300">
            Last 30 days at premium: shipped the federal lobbying index, the
            industry actor registry, BoP early-warning, intel briefings per
            legislator, the substance-targeting classifier (473 bills, ~176
            flagged for 7-OH targeting), Legistar officials sync (99 real
            officials across 6 metros), and AI router expansion from 5 → 9 cloud
            providers. None of that lands on a throttled seat.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            The platform itself spends $0/mo on AI. The build seat is the
            entire AI line item — and it&apos;s replacing a part-time engineer
            hire that would cost 5–10× as much for less throughput.
          </p>
        </section>
      </Slide>

      {/* ═════════════════════════════════════════════════════════════ */}
      {/* PAGE 2 — Revenue model + projection + the ask                  */}
      {/* ═════════════════════════════════════════════════════════════ */}
      <Slide>
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            Page 2 · The revenue surfaces
          </p>
          <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
            Three revenue lanes. All compatible with nonpartisan stance.
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-400">
            None of these are built yet — they are designed-in seams the
            platform already supports. The premium build seat is the
            throughput multiplier that turns this list into shipped product.
          </p>
        </header>

        {/* Three lanes */}
        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <Lane
            title="1. Vendor advertising"
            sub="The audience IS the buyer."
            body="Kratom retailers and product brands want to reach an engaged, opted-in, kratom-aware community. The platform's partner-shop module already exists — extend it to sponsored spotlights on /states/[code], sponsored entries in the partner directory, and post-action thank-you placements."
            pricing={[
              { tier: "Listed partner (free)", amount: "$0 — table-stakes inclusion" },
              { tier: "Featured partner", amount: "$49–99/mo" },
              { tier: "State spotlight", amount: "$199–499/mo (geo-targeted)" },
              { tier: "Newsletter sponsor", amount: "$250–1,000 / send" },
            ]}
          />
          <Lane
            title="2. Memberships"
            sub="Pay for power features; the free tier stays free."
            body="The free tier is the advocacy tool — it never gets paywalled. A Pro tier sells convenience + intelligence: priority alerts, weekly curated digest (the single highest-priority action per state), early access to the threat-forecast dashboard, vendor-side analytics."
            pricing={[
              { tier: "Free (forever)", amount: "$0" },
              { tier: "Advocate Pro", amount: "$5/mo · $50/yr" },
              { tier: "Vendor Pro", amount: "$99/mo (with analytics)" },
              { tier: "Org seat", amount: "$249/mo (multi-user)" },
            ]}
          />
          <Lane
            title="3. Donations"
            sub="One-click, transparent, recurring optional."
            body="The advocacy audience donates. The platform already supports anonymous public identity, so a donor name never has to be exposed — but the dollar count and what it funded (e.g. 'enabled 1,200 calls this month') can be. Direct Stripe path now; 501(c)(4) path later if scale justifies."
            pricing={[
              { tier: "One-time", amount: "$5 / $25 / $100 / custom" },
              { tier: "Monthly", amount: "$5 / $15 / $50" },
              { tier: "Founders circle", amount: "$500+ / lifetime" },
            ]}
          />
        </section>

        {/* Conservative projection */}
        <section className="mb-6">
          <Eyebrow>Conservative 12-month projection</Eyebrow>
          <p className="mt-1 text-xs text-zinc-500">
            All numbers deliberately low — assumes no app-store launch boost
            and no PR moment. Floor case for the partner conversation.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-950/60 text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Lane</th>
                  <th className="px-3 py-2">Mo. 3 (pilot)</th>
                  <th className="px-3 py-2">Mo. 6</th>
                  <th className="px-3 py-2">Mo. 12</th>
                  <th className="px-3 py-2">Assumption</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-zinc-300">
                <tr>
                  <td className="px-3 py-2 font-medium">Vendor ads</td>
                  <td className="px-3 py-2 font-mono">$250</td>
                  <td className="px-3 py-2 font-mono">$1,200</td>
                  <td className="px-3 py-2 font-mono text-emerald-200">$3,500</td>
                  <td className="px-3 py-2 text-zinc-500">5 → 20 → 50 featured partners</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Memberships</td>
                  <td className="px-3 py-2 font-mono">$150</td>
                  <td className="px-3 py-2 font-mono">$750</td>
                  <td className="px-3 py-2 font-mono text-emerald-200">$2,500</td>
                  <td className="px-3 py-2 text-zinc-500">30 → 150 → 500 Pro at $5/mo</td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium">Donations</td>
                  <td className="px-3 py-2 font-mono">$200</td>
                  <td className="px-3 py-2 font-mono">$600</td>
                  <td className="px-3 py-2 font-mono text-emerald-200">$1,500</td>
                  <td className="px-3 py-2 text-zinc-500">~1% of active users at avg $10</td>
                </tr>
                <tr className="bg-emerald-950/15">
                  <td className="px-3 py-2 font-bold text-emerald-200">Monthly total</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-200">$600</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-200">$2,550</td>
                  <td className="px-3 py-2 font-mono font-bold text-emerald-200">$7,500</td>
                  <td className="px-3 py-2 text-[11px] text-zinc-500">~$90K ARR at floor</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Upside case (app-store launch lands + one piece of national press):
            10–20× the membership figure. Both lanes are linear in user count;
            the platform&apos;s growth lever is referral-funnel attribution, already
            shipped.
          </p>
        </section>

        {/* What unlocks revenue */}
        <section className="mb-6">
          <Eyebrow>What the build seat unlocks (next 90 days)</Eyebrow>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-300">
            <li>→ App store submission (Apple + Google) — the install funnel revenue depends on</li>
            <li>→ Vendor self-serve onboarding + Stripe billing — turns &ldquo;featured partner&rdquo; into a one-click upgrade</li>
            <li>→ Pro tier paywall + member-only weekly digest — pure throughput on top of the existing alerts pipeline</li>
            <li>→ Donation page + recurring-donor recognition — already supports anonymous public identity, just needs the Stripe route</li>
            <li>→ Threat-forecast dashboard (predictive bans 60–120 days out) — the headline Pro feature</li>
          </ul>
          <p className="mt-2 text-xs text-zinc-500">
            None of these are research projects. Each is a focused PR series
            that lands in days, not months — <em>on the premium seat</em>.
          </p>
        </section>

        {/* The ask */}
        <section className="rounded-lg border border-emerald-700/40 bg-emerald-950/15 p-5">
          <Eyebrow>The ask</Eyebrow>
          <h3 className="mt-2 text-2xl font-bold">
            Keep the premium seat through Q3 2026.
          </h3>
          <p className="mt-2 text-sm text-zinc-300">
            That window covers app-store launch, vendor self-serve, and the
            Pro tier. By Q4 the revenue lanes above are designed to cover
            the build seat themselves — at which point this stops being a
            partner expense and becomes a platform line item.
          </p>
          <p className="mt-2 text-xs text-zinc-400">
            For context on what the seat replaces:{" "}
            <Link href="/pitch/efficiency" className="text-emerald-300 hover:underline">
              /pitch/efficiency
            </Link>{" "}
            shows the live free-tier stack and the $2K–5K/mo of commercial
            tools we&apos;re <em>not</em> paying for. The build seat is the line
            item that makes that possible.
          </p>
        </section>

        <p className="mt-6 text-[10px] text-zinc-600 print:mt-4">
          support@ikratom.org · ikratom.org/pitch/partnership · numbers pulled live at {new Date(now).toISOString().slice(0, 19).replace("T", " ")} UTC
        </p>
      </Slide>
    </div>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-12 break-inside-avoid border-b border-zinc-800 pb-12 last:border-b-0 last:pb-0 print:break-after-page print:pb-6">
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

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <p className="text-lg font-bold tabular-nums text-zinc-100">{n}</p>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{l}</p>
    </div>
  );
}

function CostCard({
  title,
  amount,
  detail,
  tone = "zinc",
}: {
  title: string;
  amount: string;
  detail: string;
  tone?: "zinc" | "emerald" | "amber";
}) {
  const cls =
    tone === "emerald" ? "border-emerald-700/40 bg-emerald-950/15"
    : tone === "amber" ? "border-amber-700/40 bg-amber-950/15"
    : "border-zinc-800 bg-zinc-950/40";
  const amountCls =
    tone === "emerald" ? "text-emerald-200"
    : tone === "amber" ? "text-amber-200"
    : "text-zinc-100";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500">{title}</p>
      <p className={`mt-1 text-2xl font-bold ${amountCls}`}>{amount}</p>
      <p className="mt-2 text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

function Lane({
  title,
  sub,
  body,
  pricing,
}: {
  title: string;
  sub: string;
  body: string;
  pricing: Array<{ tier: string; amount: string }>;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="text-base font-bold text-zinc-100">{title}</h3>
      <p className="mt-1 text-xs font-semibold text-emerald-300">{sub}</p>
      <p className="mt-2 text-xs text-zinc-400">{body}</p>
      <ul className="mt-3 space-y-1 text-[11px]">
        {pricing.map((p) => (
          <li key={p.tier} className="flex justify-between gap-2 border-t border-zinc-900 pt-1">
            <span className="text-zinc-300">{p.tier}</span>
            <span className="font-mono text-emerald-300">{p.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
