import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Intel hub — kratom policy",
  description: "Federal lobbying disclosures, legislator donor profiles, and the structural map of kratom-industry political influence.",
};
export const dynamic = "force-dynamic";

/**
 * /intel — the Art-of-War hub.
 *
 * Lays out the platform's intel sources in one place: federal
 * lobbying (Senate LDA), legislator donors (OpenFEC), per-legislator
 * briefings, per-state legislator triages. Anchors the "this isn't
 * surface-level reporting; this is intel-agency-grade research"
 * positioning the user articulated.
 */
export default async function IntelHubPage() {
  const sb = await createClient();

  // Quick aggregates for the hub
  const [lobbyingCount, donorCount, briefingCount, stanceCount] = await Promise.all([
    sb.from("lobbying_filings").select("id", { count: "exact", head: true }),
    sb.from("legislator_donors").select("legislator_id", { count: "exact", head: true }).eq("resolved_status", "matched"),
    sb.from("legislators").select("id", { count: "exact", head: true }).eq("active", true),
    sb.from("legislator_kratom_stance").select("legislator_id", { count: "exact", head: true }).neq("stance", "unknown"),
  ]);

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
          <strong className="text-zinc-200">501(c)(4) lobbying</strong>, dark-money advocacy spend, and DC-firm retainers that disclose only the topline dollars (not who funds them). This hub indexes every public record we can pull together.
        </p>
      </header>

      <section className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="LDA lobbying filings"
          value={lobbyingCount.count?.toLocaleString() ?? "0"}
          sub="kratom-mentioning federal disclosures"
        />
        <StatCard
          label="Federal donor profiles"
          value={donorCount.count?.toLocaleString() ?? "0"}
          sub="of ~531 federal legislators"
        />
        <StatCard
          label="Active legislators"
          value={briefingCount.count?.toLocaleString() ?? "0"}
          sub="all have an /briefing page"
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
          title="Bills — committee leverage map"
          body="Every active kratom bill. When you&apos;re signed in, see which ones sit in committees where YOUR reps serve — the actual leverage windows."
        />
      </section>

      <section className="mt-10 rounded-lg border border-zinc-800 bg-zinc-950/40 p-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Honest gaps</h2>
        <p className="mt-2 text-sm text-zinc-300">
          What we don&apos;t yet have:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-zinc-400">
          <li>· <strong className="text-zinc-300">State-level lobbying disclosures</strong> — 50 different state portals. AKA reports $4.4M state lobbying over 5 years but it&apos;s not centralized. State-by-state scraping effort (Phase 3).</li>
          <li>· <strong className="text-zinc-300">501(c)(4) donor identity</strong> — AKA and GKC don&apos;t have to disclose who funds them. Form 990s show topline but not donor list. This is the &quot;dark money&quot; structural gap; only investigative journalism breaks it.</li>
          <li>· <strong className="text-zinc-300">Voting records</strong> — roll-call data via LegiScan is on the roadmap.</li>
          <li>· <strong className="text-zinc-300">Personal financial disclosures</strong> — federal STOCK Act PTRs are public but PDF-only and require parsing.</li>
          <li>· <strong className="text-zinc-300">Press releases / public statements per legislator</strong> — would need a different news ingestion source.</li>
        </ul>
      </section>

      <footer className="mt-8 text-[10px] text-zinc-500">
        Data sources: Senate LDA (<a href="https://lda.senate.gov/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">lda.senate.gov</a>), OpenFEC (<a href="https://api.open.fec.gov/developers/" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">api.open.fec.gov</a>), ProPublica Nonprofit Explorer, OpenStates. All public record.
      </footer>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-zinc-100">{value}</p>
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
