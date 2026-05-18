import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/modules/admin/actions";

export const metadata = {
  title: "Intel hub — kratom policy",
  description: "Federal lobbying, court litigation, rulemaking, money flow, and the structural map of kratom-industry political influence.",
};
export const dynamic = "force-dynamic";

/**
 * /intel — the command center.
 *
 * Indexes the full federal intel stack we now pull together: Senate
 * LDA lobbying filings, CourtListener court records, Regulations.gov
 * rulemaking, USAspending.gov federal money flow, OpenFEC donors,
 * the hand-curated industry actor registry, and the per-state intel
 * triages.
 *
 * Anchor: "this isn't surface-level reporting; this is intel-agency-
 * grade research across every free public-data source we could plug
 * into." That positioning is the user's articulated framing.
 */
export default async function IntelHubPage() {
  const sb = await createClient();

  // "Honest gaps" section is admin-only — exposing capability gaps
  // publicly tells adversaries exactly where we're weakest. The list
  // is internally valuable (roadmap visibility) but strategically
  // costly when public.
  const adminCtx = await getAdminContext();
  const isAdminOrOwner = adminCtx.ok && (adminCtx.isAdmin || adminCtx.isOwner);

  // Quick aggregates for the hub. All counts; no row data so each
  // query is cheap.
  const [
    lobbyingCount,
    donorCount,
    briefingCount,
    stanceCount,
    courtCasesCount,
    federalRulemakingCount,
    openCommentCount,
    federalAwardsAgg,
    industryPartyCasesCount,
    // Threat-matrix headline inputs — anti-bill primary-sponsor count
    // is our best "active opponent" proxy without running the full
    // matrix scorer here (which is heavy). Same data the matrix uses;
    // signal-derived hostile tier rests on this signal.
    antiPrimarySponsorshipsRaw,
    proPrimarySponsorshipsRaw,
    activeAntiBillsCount,
  ] = await Promise.all([
    sb.from("lobbying_filings").select("id", { count: "exact", head: true }),
    sb.from("legislator_donors").select("legislator_id", { count: "exact", head: true }).eq("resolved_status", "matched"),
    sb.from("legislators").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("legislator_kratom_stance").select("legislator_id", { count: "exact", head: true }).neq("stance", "unknown"),
    sb.from("court_cases").select("id", { count: "exact", head: true }),
    sb.from("federal_rulemaking").select("id", { count: "exact", head: true }),
    sb.from("federal_rulemaking").select("id", { count: "exact", head: true }).eq("open_for_comment", true),
    sb.from("federal_awards").select("amount"),
    sb.from("court_cases").select("id", { count: "exact", head: true }).eq("parties_industry", true),
    sb
      .from("bill_sponsors")
      .select("legislator_id, bills!inner(state, active, kratom_relevance)")
      .eq("classification", "primary")
      .eq("bills.active", true)
      .eq("bills.kratom_relevance", "anti"),
    sb
      .from("bill_sponsors")
      .select("legislator_id, bills!inner(state, active, kratom_relevance)")
      .eq("classification", "primary")
      .eq("bills.active", true)
      .eq("bills.kratom_relevance", "pro"),
    sb
      .from("bills")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("kratom_relevance", "anti"),
  ]);

  // Distinct legislator counts + state breadth for the threat-matrix
  // headline. "Active opponents" today = unique primary anti-sponsors.
  // The full matrix on /intel/threat-matrix layers in stance + committee
  // + donor signals for finer tiering; here we surface the most
  // legible top-line number.
  const antiPrimaryLegs = new Set<string>();
  const antiPrimaryStates = new Set<string>();
  for (const r of (antiPrimarySponsorshipsRaw.data ?? []) as Array<{
    legislator_id: string;
    bills: { state: string } | Array<{ state: string }> | null;
  }>) {
    antiPrimaryLegs.add(r.legislator_id);
    const b = Array.isArray(r.bills) ? r.bills[0] : r.bills;
    if (b?.state) antiPrimaryStates.add(b.state);
  }
  const proPrimaryLegs = new Set<string>();
  for (const r of (proPrimarySponsorshipsRaw.data ?? []) as Array<{
    legislator_id: string;
  }>) {
    proPrimaryLegs.add(r.legislator_id);
  }

  // Sum federal-award dollar amounts
  const awardTotal = (federalAwardsAgg.data ?? []).reduce(
    (sum: number, r: { amount?: number | null }) => sum + (Number(r.amount) || 0),
    0,
  );
  const awardCount = (federalAwardsAgg.data ?? []).length;
  const awardTotalFmt = awardTotal >= 1_000_000
    ? `$${(awardTotal / 1_000_000).toFixed(1)}M`
    : awardTotal >= 1_000
    ? `$${(awardTotal / 1_000).toFixed(0)}k`
    : `$${awardTotal}`;

  // Top 3 most-active operations — clusters by bill activity in the
  // last 180 days. Single-glance answer to "which operation is the
  // biggest live threat right now?" Defensive — pre-migration deploys
  // (before cluster tables) skip silently.
  type TopOp = { slug: string; name: string; posture: string; bills_recent: number; states_recent: number };
  let topActiveOps: TopOp[] = [];
  try {
    const CUTOFF = new Date(Date.now() - 180 * 86400 * 1000).toISOString().slice(0, 10);
    const { data: opsMembers } = await sb
      .from("bill_cluster_members")
      .select("bill_clusters!inner(slug, name, posture), bills!inner(state, last_action_at, active)")
      .eq("bills.active", true)
      .gte("bills.last_action_at", CUTOFF);
    type Joined = {
      bill_clusters: { slug: string; name: string; posture: string } | Array<{ slug: string; name: string; posture: string }> | null;
      bills: { state: string } | Array<{ state: string }> | null;
    };
    const norm = <T,>(x: T | T[] | null): T | null => Array.isArray(x) ? x[0] ?? null : x;
    const acc = new Map<string, TopOp & { state_set: Set<string> }>();
    for (const m of (opsMembers ?? []) as Joined[]) {
      const cl = norm(m.bill_clusters);
      const bl = norm(m.bills);
      if (!cl || !bl) continue;
      const cur = acc.get(cl.slug) ?? {
        slug: cl.slug, name: cl.name, posture: cl.posture,
        bills_recent: 0, states_recent: 0, state_set: new Set<string>(),
      };
      cur.bills_recent += 1;
      cur.state_set.add(bl.state);
      acc.set(cl.slug, cur);
    }
    topActiveOps = [...acc.values()]
      .map((x) => ({ ...x, states_recent: x.state_set.size }))
      .sort((a, b) => b.bills_recent - a.bills_recent)
      .slice(0, 3);
  } catch { /* pre-migration */ }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
          ◉ Intel hub
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">
          Where the influence actually flows
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          The kratom industry&apos;s political influence does NOT show in FEC campaign contributions — the dedicated PAC (Kratom Growth) is dormant and individual contributions from kratom-business employees total ~$14k. The real flow is through{" "}
          <strong className="text-zinc-200">501(c)(4) lobbying</strong>, retained DC firms, court litigation against state bans, federal rulemaking, and federally-funded academic research. This hub indexes every public record we can pull together.
        </p>
      </header>

      {/* Action-required banner — federal comment periods open NOW */}
      {(openCommentCount.count ?? 0) > 0 && (
        <section className="mb-6 rounded-lg border-2 border-amber-600/60 bg-amber-950/25 p-4">
          <p className="text-sm font-semibold uppercase tracking-wider text-amber-300">
            🚨 {openCommentCount.count} federal public comment period{openCommentCount.count === 1 ? "" : "s"} open NOW
          </p>
          <p className="mt-1 text-xs text-amber-200/80">
            FDA / DEA / HHS rulemaking currently accepting public comments. Submitted comments become part of the official rule record. Open the rulemaking tracker to submit.
          </p>
          <Link href="/intel/rulemaking" className="mt-2 inline-block text-xs font-semibold text-emerald-400 hover:underline">
            Open rulemaking tracker →
          </Link>
        </section>
      )}

      {/* Top 3 most-active operations — single-glance threat surface.
          Bills touched in last 180d per cluster. Click through for
          full per-cluster intel (sponsors, sister clusters, LDA
          overlap, donor industries, deciding committees). */}
      {topActiveOps.length > 0 && (
        <section className="mb-6 rounded-lg border border-rose-700/40 bg-rose-950/15 p-4">
          <div className="mb-2 flex flex-wrap items-baseline gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-rose-300">
              ⚡ Most active operations · last 180 days
            </h2>
            <Link href="/intel/operations/network" className="ml-auto text-[10px] text-rose-300 hover:text-rose-200">
              Full network map →
            </Link>
          </div>
          <ul className="grid gap-2 sm:grid-cols-3">
            {topActiveOps.map((op) => (
              <li key={op.slug}>
                <Link
                  href={`/intel/operations/${op.slug}`}
                  className="block rounded border border-rose-700/30 bg-rose-950/10 px-3 py-2 hover:border-rose-500"
                >
                  <div className="text-[11px] font-semibold text-rose-100">
                    {op.name.split("—")[0].trim().split("(")[0].trim()}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-400">
                    <strong className="font-mono text-zinc-200">{op.bills_recent}</strong> bills ·{" "}
                    <strong className="font-mono text-zinc-200">{op.states_recent}</strong> state{op.states_recent === 1 ? "" : "s"}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Top-line stats — the full intel surface area */}
      <section className="mb-10 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          label="Active opponents"
          value={antiPrimaryLegs.size.toLocaleString()}
          sub={`primary anti-bill sponsors across ${antiPrimaryStates.size} states`}
          tone="amber"
        />
        <StatCard
          label="Active anti-kratom bills"
          value={activeAntiBillsCount.count?.toLocaleString() ?? "0"}
          sub={`${proPrimaryLegs.size} pro-kratom primary sponsors`}
        />
        <StatCard
          label="LDA lobbying filings"
          value={lobbyingCount.count?.toLocaleString() ?? "0"}
          sub="kratom-mentioning Senate disclosures"
        />
        <StatCard
          label="Federal donor profiles"
          value={donorCount.count?.toLocaleString() ?? "0"}
          sub="OpenFEC, of ~531 federal legs"
        />
        <StatCard
          label="Court cases"
          value={courtCasesCount.count?.toLocaleString() ?? "0"}
          sub={`${industryPartyCasesCount.count ?? 0} industry-party`}
        />
        <StatCard
          label="Federal rulemaking docs"
          value={federalRulemakingCount.count?.toLocaleString() ?? "0"}
          sub={`${openCommentCount.count ?? 0} open for comment`}
          tone={(openCommentCount.count ?? 0) > 0 ? "amber" : undefined}
        />
        <StatCard
          label="Federal awards"
          value={awardCount.toLocaleString()}
          sub={`${awardTotalFmt} flowing federally`}
        />
        <StatCard
          label="Active legislators"
          value={briefingCount.count?.toLocaleString() ?? "0"}
          sub="all have a /briefing page"
        />
        <StatCard
          label="Real-signal stances"
          value={stanceCount.count?.toLocaleString() ?? "0"}
          sub="non-unknown drafts"
        />
      </section>

      {/* Surface entries */}
      <section className="space-y-4">
        <Card
          href="/intel/lobbying"
          emoji="📜"
          title="Federal lobbying intel"
          body="Every Senate LDA filing mentioning kratom — AKA, GKC, Botanical Education Alliance, MIT45, and every retained DC firm. Filter by year / client / registrant. Lobbyist names + government entities contacted + disclosed dollar amounts."
          highlight
        />
        <Card
          href="/intel/cases"
          emoji="⚖"
          title="Court litigation tracker"
          body="Kratom-related court cases — published opinions interpreting state schedules and active RECAP dockets (where AKA / Botanic Tonics / GKC sue states or each other). The second battlefield after legislatures. Sourced from CourtListener / Free Law Project."
          highlight
        />
        <Card
          href="/intel/rulemaking"
          emoji="🏛"
          title="Federal rulemaking + open comment periods"
          body="FDA / DEA / HHS / FTC kratom-related rulemaking from Regulations.gov. Active public-comment periods surface at the top with submit-now CTAs. When a federal agency opens a kratom rule, advocates can directly influence the final language."
          highlight={(openCommentCount.count ?? 0) > 0}
        />
        <Card
          href="/intel/awards"
          emoji="💰"
          title="Federal money flow"
          body="Federal grants + contracts mentioning kratom from USAspending.gov. Who's getting paid by FDA / NIH / DEA to research, evaluate, or study kratom. The papers and findings funded by these awards become the evidence cited in future scheduling decisions."
        />
        <Card
          href="/intel/threat-matrix"
          emoji="🎯"
          title="Threat matrix — who to target, who to flip"
          body="Every active legislator scored on a composite of stance, sponsorships, committee leverage, donor industries, and STOCK Act personal trades. Triaged into seven action tiers (active opponents / hostile decision-makers / flippable targets / champions / sympathetic allies / education targets / low-priority). The single targeting view that answers 'who do I focus on?'"
          highlight
        />
        <Card
          href="/intel/operations/network"
          emoji="🕸"
          title="Operations network map — the coordination graph"
          body="Multi-cluster legislators (the most-coordinated individual operators), cross-cluster bills (hybrid tactics), federal lobbyist concentration, state coordination index, industry-actor registry. Five views of the network in one dashboard."
          highlight
        />
        <Card
          href="/intel/operations"
          emoji="🕸"
          title="Coordinated operations — model legislation, named + traced"
          body="Kratom-policy adversaries don't operate state-by-state independently. They use model legislation — the same operative language pushed in multiple states simultaneously by lobbyist networks. This surface names every detected operation (KCPA framework, ICE Out sweep, Synthetic-only ban, Schedule I total ban, Age-21, Lab-testing, Retail-license), lists every bill in each cluster, and exposes the recurring signature phrases."
          highlight
        />
        <Card
          href="/intel/donations"
          emoji="🧮"
          title="Donor intel — conflict-of-interest leaderboard"
          body="Federal legislators ranked by total contributions from substance-policy-adjacent industries (pharma, alcohol, tobacco, hospital, addiction-treatment, cannabis, gaming). The kratom industry itself contributes essentially zero via FEC — but industries that would BENEFIT from a kratom ban show up here. Click any row for that legislator's full briefing."
        />
        <Card
          href="/intel/actors"
          emoji="🎭"
          title="Industry actor registry"
          body="The people behind the dollars. Lobbyists (Haddow, Carlucci, Sermonti), industry orgs (AKA, GKC, BEA), kratom company executives, the regulators with public positions. Every entry cites public-record evidence."
        />
        <Card
          href="/legislators"
          emoji="🪪"
          title="Legislators — start with a state or your reps"
          body="Every active legislator across 50 states + DC has a profile and an intel briefing. Federal legislators also have donor profiles from OpenFEC. Click any → ◉ Intel briefing → for the full per-person memo with action plan."
        />
        <Card
          href="/states"
          emoji="🗺"
          title="State briefings — per-state legislator triage"
          body="Every legislator in a state with kratom signal, triaged into 6 action buckets (active opponents, hostile decision-makers, champions, sympathetic allies, education targets, unknown but in position)."
        />
        <Card
          href="/bills"
          emoji="📋"
          title="Bills — committee leverage map + cross-state similarity"
          body="Every active kratom bill. Click any → see committee leverage AND the bills it most resembles in other states (the KCPA wave is visible)."
        />
      </section>

      {/* "Honest gaps" — admin-only. Public visitors see no roadmap
          telegraphing where we're weakest. Adversaries don't need our
          help finding the seams. */}
      {isAdminOrOwner && (
        <section className="mt-10 rounded-lg border border-amber-700/40 bg-amber-950/15 p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
              Honest gaps · admin only
            </h2>
            <span className="rounded-full bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
              🔒 internal
            </span>
          </div>
          <p className="mt-2 text-[11px] text-amber-200/70">
            Hidden from public visitors. Telegraphing capability gaps to adversaries is strategically costly; this section is for owner/admin roadmap visibility only.
          </p>
          <p className="mt-2 text-sm text-zinc-300">
            What we don&apos;t yet have:
          </p>
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            <li>· <strong className="text-zinc-300">Roll-call voting records</strong> — table + sync code shipped (LegiScan + OpenStates fallback). LegiScan path needs an API key in CI secrets to fully populate; OpenStates path is chipping at ~50 bills/day.</li>
            <li>· <strong className="text-zinc-300">State-level lobbying disclosures</strong> — UT pilot live (16 active AKA / Botanic Tonics registrations captured). FL / NJ / CA / TX queued — each state needs its own adapter due to different bot-detection.</li>
            <li>· <strong className="text-zinc-300">501(c)(4) donor identity</strong> — AKA and GKC don&apos;t have to disclose who funds them. Form 990s show topline but not donor list. The structural &quot;dark money&quot; gap; only investigative journalism breaks it.</li>
            <li>· <strong className="text-zinc-300">Personal financial disclosures (STOCK Act)</strong> — federal legislators&apos; personal stock trades. Public but PDF-only and require parsing. On the roadmap as D3.</li>
            <li>· <strong className="text-zinc-300">Per-legislator press releases</strong> — current news scrape is kratom-policy-focused not legislator-focused. A per-legislator press-release scraper would lift the news_mentions signal density meaningfully.</li>
          </ul>
        </section>
      )}

      <footer className="mt-8 text-[10px] text-zinc-500">
        Data sources: Senate LDA (<a href="https://lda.senate.gov/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">lda.senate.gov</a>),
        {" "}OpenFEC,
        {" "}OpenStates,
        {" "}LegiScan,
        {" "}<a href="https://www.courtlistener.com" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">CourtListener / Free Law Project</a>,
        {" "}<a href="https://www.regulations.gov" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Regulations.gov</a>,
        {" "}<a href="https://www.usaspending.gov" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">USAspending.gov</a>,
        {" "}ProPublica Nonprofit Explorer, lobbyist.utah.gov. All public record.
      </footer>
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "amber" }) {
  const cls = tone === "amber"
    ? "border-amber-700/50 bg-amber-950/20"
    : "border-zinc-800 bg-zinc-950/40";
  const valCls = tone === "amber" ? "text-amber-200" : "text-zinc-100";
  return (
    <div className={`rounded-md border p-4 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold tabular-nums ${valCls}`}>{value}</p>
      <p className="mt-1 text-[10px] text-zinc-500">{sub}</p>
    </div>
  );
}

function Card({ href, emoji, title, body, highlight }: { href: string; emoji: string; title: string; body: string; highlight?: boolean }) {
  const cls = highlight
    ? "border-2 border-emerald-500 bg-emerald-950/15 hover:border-emerald-400"
    : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500";
  return (
    <Link href={href} className={`block rounded-lg p-5 transition ${cls}`}>
      <h3 className="text-base font-semibold text-zinc-100">
        <span aria-hidden className="mr-2">{emoji}</span>
        {title}
      </h3>
      <p className="mt-1 text-sm text-zinc-400">{body}</p>
    </Link>
  );
}
