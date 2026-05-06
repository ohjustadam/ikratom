export const metadata = { title: "Glossary" };

const TERMS: Array<{ term: string; def: string; aka?: string }> = [
  { term: "Kratom", def: "Common name for Mitragyna speciosa, a tropical evergreen tree native to Southeast Asia. The leaves contain alkaloids used as a stimulant in low doses and a sedative in higher doses." },
  { term: "Mitragynine", def: "The primary alkaloid in natural kratom leaf — accounts for 60–66% of total alkaloid content. Mu-opioid partial agonist; the primary driver of kratom's effects." },
  { term: "7-OH / 7-hydroxymitragynine", aka: "7-OH", def: "Minor alkaloid in natural leaf (~2% of total alkaloid content). About 13× more potent at the mu-opioid receptor than mitragynine. Concentrated/synthesized 7-OH products are the focus of most current restrictive legislation." },
  { term: "Natural leaf", def: "Whole or powdered kratom leaf prepared by traditional means (drying, grinding, simmering). Contains the full alkaloid profile in naturally occurring ratios. Distinct from concentrated extracts and synthetic products." },
  { term: "Synthetic / semi-synthetic kratom", def: "Alkaloids produced by chemical synthesis or biosynthetic means (fermentation, recombinant techniques) rather than extracted from the plant. Includes purified mitragynine with elevated 7-OH levels not found in natural leaf. Most state legislation in 2025–2026 targets these specifically." },
  { term: "Alkaloid", def: "A nitrogen-containing organic compound, often pharmacologically active. Kratom has 40+ alkaloids; the main ones discussed in policy are mitragynine and 7-hydroxymitragynine." },
  { term: "KCPA", aka: "Kratom Consumer Protection Act", def: "A model regulatory framework promoted by the American Kratom Association. Sets age limits, labeling standards, lab-testing requirements, and prohibits adulterated products. Adopted in some form by 13+ states. The KCPA model is generally pro-leaf-access." },
  { term: "Schedule I", def: "U.S. Controlled Substances Act classification for substances with 'no currently accepted medical use and a high potential for abuse.' Heroin, LSD, cannabis (federally), psilocybin. Kratom is NOT federally Schedule I, despite a 2016 DEA attempt." },
  { term: "Schedule II", def: "Controlled-substance classification for drugs with high abuse potential but accepted medical use; requires prescription. Cocaine, methamphetamine, oxycodone. As of 2026, no state has placed kratom on Schedule II, though some have proposed it for synthetic 7-OH specifically." },
  { term: "AKA", aka: "American Kratom Association", def: "Largest U.S. kratom advocacy organization. Founded 2014. Pushes the KCPA model state-by-state. Maintains GMP (Good Manufacturing Practices) standards program." },
  { term: "GKC", aka: "Global Kratom Coalition", def: "Industry-aligned advocacy group. Focuses on regulatory engagement and consumer protection." },
  { term: "MAC", aka: "Medical Advisory Committee", def: "An AKA-affiliated body of medical professionals advocating for kratom access in clinical settings." },
  { term: "BAE", aka: "Botanical Education Alliance", def: "Educational nonprofit; produces materials about botanical supplements including kratom." },
  { term: "FDA Import Alert 54-15", def: "Federal Drug Administration policy enabling FDA to detain kratom shipments without physical examination. Active since 2014." },
  { term: "OpenStates", def: "Free legislative-data API used by iKratom to sync state bill data. Covers 50 states + DC + PR + federal Congress (with separate jurisdiction codes)." },
  { term: "GMP", aka: "Good Manufacturing Practices", def: "Quality-assurance program for kratom vendors. AKA-administered. Requires lab testing, contamination controls, accurate labeling. Vendors that pass earn the GMP seal." },
  { term: "Wave (campaign wave)", def: "An iKratom feature: coordinated send window. Advocates sign up; at the scheduled minute, every signed-up user's email goes out via their own Gmail in a compressed window. Increases legislator-staff perception of constituent attention." },
  { term: "Constituent", def: "A resident of a legislator's district. Legislators give exponentially more weight to constituent communication than to out-of-district communication. iKratom matches you to your specific legislators by address." },
  { term: "PMK / mu-opioid receptor", aka: "Mu", def: "The primary opioid receptor type. Mitragynine and 7-OH are partial agonists at this receptor — meaning they activate it but with a ceiling effect that limits respiratory depression compared to traditional opioids." },
];

const ANCHOR = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function GlossaryPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
          Glossary
        </p>
        <h1 className="mt-2 text-4xl font-bold sm:text-5xl">Kratom advocacy terms</h1>
        <p className="mt-3 max-w-2xl text-zinc-400">
          Plain-English definitions for the terms that show up in bills, news,
          and forum threads. Linkable from anywhere on the platform — just append{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-xs text-emerald-300">#term</code>.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap gap-2 text-xs">
        {TERMS.map((t) => (
          <a
            key={t.term}
            href={`#${ANCHOR(t.term)}`}
            className="rounded-full border border-zinc-800 px-3 py-1 text-zinc-400 hover:border-emerald-500 hover:text-emerald-300"
          >
            {t.term}
          </a>
        ))}
      </div>

      <dl className="space-y-6">
        {TERMS.map((t) => (
          <div
            key={t.term}
            id={ANCHOR(t.term)}
            className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-5 scroll-mt-20"
          >
            <dt className="text-lg font-bold">
              {t.term}
              {t.aka && <span className="ml-2 text-sm font-normal text-zinc-500">aka {t.aka}</span>}
            </dt>
            <dd className="mt-2 text-sm text-zinc-300">{t.def}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
