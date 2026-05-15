import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResearchSubmitCta } from "./ResearchSubmitCta";
import { ResearchBrowser, type PaperRow } from "./ResearchBrowser";

export const metadata = {
  title: "Kratom + 7-OH research library — peer-reviewed evidence",
  description: "Curated, AI-evaluated library of peer-reviewed kratom and 7-hydroxymitragynine research. Conservative methodology scoring, original abstracts always preserved, sourced from PubMed.",
};
export const dynamic = "force-dynamic";

const STRENGTH_COLORS: Record<string, string> = {
  strong: "border-emerald-700/50 bg-emerald-950/20 text-emerald-300",
  moderate: "border-emerald-900/40 bg-emerald-950/10 text-emerald-400",
  weak: "border-amber-700/40 bg-amber-950/10 text-amber-300",
  preliminary: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
  inconclusive: "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

const STUDY_TYPE_LABEL: Record<string, string> = {
  rct: "Randomized trial",
  review: "Systematic review",
  observational: "Observational",
  case_report: "Case report",
  in_vitro: "In vitro",
  animal: "Animal study",
  survey: "Survey",
  clinical: "Clinical",
};

export default async function ResearchIndex({ searchParams }: { searchParams?: Promise<{ topic?: string; type?: string; min_quality?: string }> }) {
  const sp = (await searchParams) ?? {};
  const topicFilter = sp.topic ?? null;
  const typeFilter = sp.type ?? null;
  const minQuality = sp.min_quality ? parseInt(sp.min_quality) : null;

  const sb = await createClient();
  let q = sb.from("research_papers")
    .select("id, pubmed_id, title, authors, journal, publication_year, study_type, topics, ai_methodology_quality, ai_evidence_strength, ai_key_findings_md, ai_distinguishes_natural_vs_synthetic, doi, full_text_url, retracted, citation_count")
    .eq("is_active", true)
    .order("publication_year", { ascending: false, nullsFirst: false })
    .order("ai_methodology_quality", { ascending: false, nullsFirst: false })
    .limit(120);
  if (topicFilter) q = q.contains("topics", [topicFilter]);
  if (typeFilter) q = q.eq("study_type", typeFilter);
  if (minQuality) q = q.gte("ai_methodology_quality", minQuality);

  const { data: papers } = await q;
  const rows = papers ?? [];

  // For the topic/type filter pills, aggregate counts
  const { data: all } = await sb
    .from("research_papers")
    .select("topics, study_type, ai_methodology_quality")
    .eq("is_active", true);
  const topicCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let totalEvaluated = 0;
  for (const r of all ?? []) {
    for (const t of (r.topics ?? []) as string[]) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
    if (r.study_type) typeCounts.set(r.study_type as string, (typeCounts.get(r.study_type as string) ?? 0) + 1);
    if (r.ai_methodology_quality != null) totalEvaluated++;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          📚 Research library
        </p>
        <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Kratom + 7-OH peer-reviewed evidence</h1>
        <p className="mt-3 max-w-3xl text-sm text-zinc-400">
          Open, sourced from PubMed. Every paper carries the original abstract — never
          replaced. Alongside it, a conservative AI evaluation flags methodology quality,
          sample-size adequacy, bias indicators, and evidence strength.
          A paper that clearly distinguishes <strong className="text-emerald-300">natural-leaf kratom</strong>{" "}
          from <strong className="text-amber-300">7-OH-enriched / synthetic products</strong>{" "}
          gets a special badge — that distinction often matters more than the headline finding.
        </p>
        <p className="mt-2 text-xs text-zinc-500">
          {all?.length ?? 0} papers ingested · {totalEvaluated} AI-evaluated.
        </p>
        <ResearchSubmitCta />
      </header>

      {/* Topic filter */}
      {topicCounts.size > 0 && (
        <nav className="mb-3 flex flex-wrap gap-2 text-xs">
          <FilterPill label={`All topics (${all?.length ?? 0})`} href={`/research${typeFilter ? `?type=${typeFilter}` : ""}`} active={!topicFilter} />
          {[...topicCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <FilterPill
              key={t}
              label={`${t.replace(/_/g, " ")} (${n})`}
              href={`/research?topic=${t}${typeFilter ? `&type=${typeFilter}` : ""}`}
              active={topicFilter === t}
            />
          ))}
        </nav>
      )}

      {/* Study type filter */}
      {typeCounts.size > 0 && (
        <nav className="mb-3 flex flex-wrap gap-2 text-xs">
          <FilterPill label="All study types" href={`/research${topicFilter ? `?topic=${topicFilter}` : ""}`} active={!typeFilter} />
          {[...typeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <FilterPill
              key={t}
              label={`${STUDY_TYPE_LABEL[t] ?? t} (${n})`}
              href={`/research?type=${t}${topicFilter ? `&topic=${topicFilter}` : ""}`}
              active={typeFilter === t}
            />
          ))}
        </nav>
      )}

      {/* Quality minimum */}
      <nav className="mb-6 flex flex-wrap gap-2 text-xs">
        <FilterPill label="Any quality" href={`/research${topicFilter ? `?topic=${topicFilter}` : typeFilter ? `?type=${typeFilter}` : ""}`} active={!minQuality} />
        {[3, 4, 5].map((q) => (
          <FilterPill
            key={q}
            label={`Quality ≥ ${q}`}
            href={`/research?min_quality=${q}${topicFilter ? `&topic=${topicFilter}` : ""}${typeFilter ? `&type=${typeFilter}` : ""}`}
            active={minQuality === q}
          />
        ))}
      </nav>

      <ResearchBrowser papers={rows as unknown as PaperRow[]} />

      <footer className="mt-10 rounded-md border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-500">
        <p className="font-semibold text-zinc-300">Methodology + sources</p>
        <p className="mt-1">
          Papers are auto-ingested from PubMed (NCBI E-utilities, free + open).
          AI evaluation uses our multi-provider router (Groq, Cerebras, Gemini, Mistral, Cloudflare AI),
          conservative by design — most papers in this field score 2-3/5. We never edit the original
          abstract; AI commentary is shown alongside, never instead.
        </p>
      </footer>
    </div>
  );
}

function FilterPill({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded px-3 py-1 ${active ? "bg-emerald-600 text-zinc-950" : "border border-zinc-800 bg-zinc-950/40 hover:border-emerald-500"}`}
    >
      {label}
    </Link>
  );
}
