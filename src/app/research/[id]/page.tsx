import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { createClient } from "@/lib/supabase/server";
import { SignUpNudge } from "@/components/SignUpNudge";

export const metadata = { title: "Research paper" };
export const dynamic = "force-dynamic";

const STRENGTH_COLORS: Record<string, string> = {
  strong: "border-emerald-700/50 bg-emerald-950/20 text-emerald-300",
  moderate: "border-emerald-900/40 bg-emerald-950/10 text-emerald-400",
  weak: "border-amber-700/40 bg-amber-950/10 text-amber-300",
  preliminary: "border-zinc-700 bg-zinc-950/40 text-zinc-400",
  inconclusive: "border-zinc-800 bg-zinc-950/40 text-zinc-500",
};

export default async function ResearchPaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string; duplicate?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const arrivedFromSubmit = sp.from === "submit";
  const wasDuplicate = sp.duplicate === "1";

  const sb = await createClient();
  const { data: p } = await sb
    .from("research_papers")
    .select("*")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (!p) notFound();

  const findingsHtml = p.ai_key_findings_md
    ? await marked.parse(p.ai_key_findings_md as string, { gfm: true, breaks: false })
    : null;

  // schema.org ScholarlyArticle — the canonical schema for research
  // papers. When AI summarizers / Google Scholar / Semantic Scholar
  // crawl this page, they get structured data they can cite verbatim
  // (authors, journal, DOI, year) instead of paraphrasing from
  // rendered text.
  const SITE = process.env.NEXT_PUBLIC_APP_URL || "https://www.ikratom.org";
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    "@id": `${SITE}/research/${p.id}`,
    headline: p.title,
    name: p.title,
    ...(Array.isArray(p.authors) && p.authors.length > 0
      ? { author: (p.authors as string[]).map((a) => ({ "@type": "Person", name: a })) }
      : {}),
    ...(p.journal ? { isPartOf: { "@type": "Periodical", name: p.journal } } : {}),
    ...(p.publication_date ? { datePublished: p.publication_date } : (p.publication_year ? { datePublished: String(p.publication_year) } : {})),
    ...(p.doi ? { identifier: { "@type": "PropertyValue", propertyID: "DOI", value: p.doi } } : {}),
    ...(p.pubmed_id ? { sameAs: [`https://pubmed.ncbi.nlm.nih.gov/${p.pubmed_id}/`] } : {}),
    ...(p.abstract ? { abstract: (p.abstract as string).slice(0, 5000) } : {}),
    ...(typeof p.citation_count === "number" ? { citationCount: p.citation_count } : {}),
    ...(p.study_type ? { learningResourceType: p.study_type } : {}),
    isAccessibleForFree: true,
    publisher: { "@type": "Organization", name: "iKratom", url: SITE },
    url: `${SITE}/research/${p.id}`,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Link href="/research" className="text-xs text-zinc-500 hover:text-emerald-400">
        ← Research library
      </Link>

      {/* Flash from /research/submit. wasDuplicate = library already had
          this URL; otherwise it's a fresh submission landing for review. */}
      {arrivedFromSubmit && (
        <div className={`mt-3 mb-4 rounded-md border-2 p-3 text-sm ${
          wasDuplicate
            ? "border-amber-700/50 bg-amber-950/15 text-amber-200"
            : "border-emerald-700/50 bg-emerald-950/15 text-emerald-200"
        }`}>
          {wasDuplicate ? (
            <>
              📚 This paper was already in the library. Taking you to its existing entry.
            </>
          ) : (
            <>
              ✓ Added to the library. Bibliographic metadata captured; topic tags + AI evaluation will populate after the next editorial pass. Thanks for contributing.
            </>
          )}
        </div>
      )}

      <header className="mt-2 mb-6 border-b border-zinc-800 pb-4">
        <div className="flex flex-wrap items-baseline gap-2 text-[11px]">
          {p.publication_year != null && <span className="font-mono text-zinc-500">{p.publication_year}</span>}
          {p.journal && <span className="text-zinc-400">{p.journal}</span>}
          {p.study_type && (
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 uppercase tracking-wider text-zinc-400">{p.study_type as string}</span>
          )}
          {p.retracted && (
            <span className="rounded bg-red-700 px-1.5 py-0.5 font-bold uppercase text-white">RETRACTED</span>
          )}
        </div>
        <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
        {(p.authors as string[] | null) && (p.authors as string[]).length > 0 && (
          <p className="mt-2 text-sm text-zinc-400">
            {(p.authors as string[]).join(", ")}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {p.pubmed_id && (
            <a href={`https://pubmed.ncbi.nlm.nih.gov/${p.pubmed_id}/`} target="_blank" rel="noopener noreferrer"
              className="rounded bg-emerald-600 px-2.5 py-1 font-semibold text-zinc-950 hover:bg-emerald-500">
              PubMed ↗
            </a>
          )}
          {p.doi && (
            <a href={`https://doi.org/${p.doi}`} target="_blank" rel="noopener noreferrer"
              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
              DOI ↗
            </a>
          )}
          {p.full_text_url && p.full_text_url !== `https://doi.org/${p.doi}` && (
            <a href={p.full_text_url} target="_blank" rel="noopener noreferrer"
              className="rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:border-emerald-500">
              Full text ↗
            </a>
          )}
        </div>
      </header>

      {/* Signup nudge — research-paper readers are high-affinity advocates */}
      <SignUpNudge context="research" className="mb-6" />

      {/* AI evaluation — surfaces first because users want the conservatism check */}
      {p.ai_evaluated_at && (
        <section className="mb-8 rounded-lg border border-emerald-700/30 bg-emerald-950/10 p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300">
            🤖 AI evaluation
          </p>
          <p className="mt-1 text-[10px] text-zinc-500">
            Conservative methodology + bias rating. Original abstract preserved below. Provider: {p.ai_evaluated_by_provider}.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Methodology" value={`${p.ai_methodology_quality ?? "?"}/5`} />
            <Metric label="Evidence strength" value={p.ai_evidence_strength as string ?? "?"} colorClass={STRENGTH_COLORS[p.ai_evidence_strength as string] ?? ""} />
            <Metric label="Sample size" value={p.ai_sample_size_adequate === true ? "Adequate" : p.ai_sample_size_adequate === false ? "Underpowered" : "?"} />
            <Metric label="Distinguishes leaf vs 7-OH" value={p.ai_distinguishes_natural_vs_synthetic ? "✓ Yes" : "✗ No"} />
          </div>

          {p.ai_sample_size_notes && (
            <p className="mt-3 text-xs italic text-zinc-400">{p.ai_sample_size_notes}</p>
          )}

          {(p.ai_bias_indicators as string[] | null) && (p.ai_bias_indicators as string[]).length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">⚠ Bias indicators</p>
              <ul className="mt-1 flex flex-wrap gap-1">
                {(p.ai_bias_indicators as string[]).map((b, i) => (
                  <li key={i} className="rounded bg-amber-950/30 px-2 py-0.5 text-[11px] text-amber-200">
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {findingsHtml && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">Key findings (AI summary)</p>
              <div
                className="briefing-md mt-1 text-sm"
                dangerouslySetInnerHTML={{ __html: findingsHtml }}
              />
            </div>
          )}

          {p.ai_relevance_natural_leaf != null && p.ai_relevance_7oh != null && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded bg-zinc-950/40 p-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Relevance to natural-leaf</p>
                <p className="mt-0.5 text-base font-semibold text-emerald-300">{Math.round((p.ai_relevance_natural_leaf as number) * 100)}%</p>
              </div>
              <div className="rounded bg-zinc-950/40 p-2">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500">Relevance to 7-OH</p>
                <p className="mt-0.5 text-base font-semibold text-amber-300">{Math.round((p.ai_relevance_7oh as number) * 100)}%</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Original abstract — never edited */}
      {p.abstract && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-zinc-300">
            Original abstract (verbatim)
          </h2>
          <article className="briefing-md text-sm whitespace-pre-wrap text-zinc-300">
            {p.abstract}
          </article>
        </section>
      )}

      {(p.topics as string[] | null) && (p.topics as string[]).length > 0 && (
        <section className="mt-6">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Topics</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(p.topics as string[]).map((t) => (
              <Link key={t} href={`/research?topic=${t}`} className="rounded bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
                {t.replace(/_/g, " ")}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className={`rounded p-2 ${colorClass || "bg-zinc-950/40"}`}>
      <p className="text-[10px] uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-0.5 text-sm font-bold uppercase">{value}</p>
    </div>
  );
}
