import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Opposition & allies — kratom/7-OH org intel",
  description: "Who's organized on kratom and 7-OH policy: the opposition, the access coalition, and the regulators — positions and public-record sources.",
  robots: { index: false }, // research data, not SEO — same posture as /intel/actors
};

export const dynamic = "force-dynamic";

type Org = {
  slug: string;
  name: string;
  stance: string;
  org_type: string | null;
  website: string | null;
  summary: string | null;
  evidence: unknown;
  confidence: string | null;
  needs_review: boolean | null;
};

const STANCE_META: Record<string, { label: string; cls: string }> = {
  anti_kratom: { label: "Anti-kratom", cls: "border-red-700/50 bg-red-950/30 text-red-200" },
  anti_7oh: { label: "Anti-7-OH", cls: "border-orange-700/50 bg-orange-950/30 text-orange-200" },
  mixed: { label: "Pro-leaf / anti-7-OH", cls: "border-amber-700/50 bg-amber-950/25 text-amber-200" },
  pro_kratom: { label: "Pro-kratom", cls: "border-emerald-700/50 bg-emerald-950/25 text-emerald-200" },
  pro_7oh: { label: "Pro-7-OH", cls: "border-teal-700/50 bg-teal-950/30 text-teal-200" },
  regulator: { label: "Regulator", cls: "border-zinc-700/50 bg-zinc-900/50 text-zinc-300" },
  unclear: { label: "Unclear", cls: "border-zinc-700/50 bg-zinc-900/50 text-zinc-400" },
};

const CONF_DOT: Record<string, string> = { high: "bg-emerald-500", medium: "bg-amber-500", low: "bg-zinc-500" };

function OrgCard({ o }: { o: Org }) {
  const meta = STANCE_META[o.stance] ?? STANCE_META.unclear;
  const evidenceCount = Array.isArray(o.evidence) ? o.evidence.length : 0;
  const host = o.website ? o.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : null;
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
        {o.org_type && <span className="text-[10px] uppercase tracking-wider text-zinc-500">{o.org_type.replace(/_/g, " ")}</span>}
        {o.confidence && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <i className={`h-1.5 w-1.5 rounded-full ${CONF_DOT[o.confidence] ?? "bg-zinc-600"}`} /> {o.confidence}
            {o.needs_review ? " · review" : ""}
          </span>
        )}
      </div>
      <h3 className="mt-2 font-semibold text-zinc-100">{o.name}</h3>
      {o.summary && <p className="mt-1 text-sm leading-relaxed text-zinc-400">{o.summary}</p>}
      <div className="mt-2 flex items-center gap-3 text-xs">
        {host && (
          <a href={o.website!} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
            {host} ↗
          </a>
        )}
        {evidenceCount > 0 && <span className="text-zinc-600">{evidenceCount} source{evidenceCount === 1 ? "" : "s"}</span>}
      </div>
    </li>
  );
}

export default async function OppositionIntelPage() {
  let orgs: Org[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("policy_orgs")
      .select("slug, name, stance, org_type, website, summary, evidence, confidence, needs_review")
      .eq("active", true)
      .order("confidence", { ascending: true })
      .order("name", { ascending: true });
    orgs = (data ?? []) as Org[];
  } catch {
    orgs = [];
  }

  const opposition = orgs.filter((o) => ["anti_kratom", "anti_7oh", "mixed"].includes(o.stance));
  const allies = orgs.filter((o) => ["pro_kratom", "pro_7oh"].includes(o.stance));
  const regulators = orgs.filter((o) => o.stance === "regulator");
  const other = orgs.filter((o) => o.stance === "unclear");

  const Section = ({ title, blurb, list }: { title: string; blurb: string; list: Org[] }) =>
    list.length === 0 ? null : (
      <section className="mt-8">
        <h2 className="text-lg font-bold text-zinc-100">{title} <span className="text-sm font-normal text-zinc-500">({list.length})</span></h2>
        <p className="mt-1 text-sm text-zinc-500">{blurb}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">{list.map((o) => <OrgCard key={o.slug} o={o} />)}</ul>
      </section>
    );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">◉ Org intel</p>
      <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Opposition & allies</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">
        Who&apos;s organized on kratom and 7-OH policy — their stated positions and the public-record sources behind
        them. Factual, not personal. Note the big split: several pro-<em>leaf</em> groups are actively{" "}
        <span className="text-amber-300">anti-7-OH</span>, so an ally on the leaf can be opposition on 7-OH.
      </p>

      {orgs.length === 0 ? (
        <p className="mt-8 rounded-lg border border-zinc-800 bg-zinc-950/40 p-8 text-center text-sm text-zinc-500">
          Roster is being compiled — check back soon.
        </p>
      ) : (
        <>
          <Section title="The opposition" blurb="Groups working to ban or restrict kratom and/or 7-OH — including pro-leaf groups pushing to schedule 7-OH." list={opposition} />
          <Section title="Access & allies" blurb="Groups defending legal access to kratom and/or 7-OH." list={allies} />
          <Section title="Regulators & government" blurb="Agencies and officials with rulemaking or enforcement authority — monitor, not pro/anti." list={regulators} />
          <Section title="Unclear / to classify" blurb="Surfaced by research but stance not yet pinned down." list={other} />
        </>
      )}

      <p className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        Compiled from public-record research; entries flagged &quot;review&quot; are not yet owner-confirmed. Positions
        and sources only — no personal judgments. <Link href="/intel/actors" className="text-emerald-400 hover:underline">See also: industry actors →</Link>
      </p>
    </div>
  );
}
