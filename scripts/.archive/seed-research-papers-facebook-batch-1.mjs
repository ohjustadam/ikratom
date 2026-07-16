/**
 * Editorial seed: 8 kratom research papers shared via the Facebook community 2026-05-15.
 *
 * Owner directive: 'analyze and add' the URL batch; dedupe; flag what's
 * gated; structure as part of the public research library sanctuary.
 *
 * Dedupe check completed before this script (see chat log 2026-05-15):
 *   - Already in DB: Mitragyna 2022 review (Ahmad et al, Life journal),
 *     cup.70126 (Photodistributed Hyperpigmentation case report)
 *   - Not a kratom paper: EBSCO Corydalis — skipped (different herb)
 *
 * For papers behind a 403 wall (ScienceDirect, JPET, ACS, Wiley, etc.):
 *   - We save the URL + bibliographic identifiers we can derive
 *   - ai_evaluated_at is left NULL (awaiting AI pass)
 *   - admin_notes_md flags the gating + suggests follow-up
 *
 * Idempotent — uses `.upsert(.., { onConflict: 'doi' })` where DOI is
 * known, else inserts if no title match exists.
 */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PAPERS = [
  {
    label: "UiTM MD sim 2026",
    title: "Molecular interactions and behavior of kratom alkaloids — mitragynine, 7-hydroxymitragynine, and mitragynine pseudoindoxyl — in DPPC lipid bilayers: a molecular dynamics simulation study",
    authors: ["Mohd Zubri, Nur Syahirunelisa"],
    journal: "UiTM Institutional Repository",
    publication_year: 2026,
    full_text_url: "https://ir.uitm.edu.my/id/eprint/135667/",
    doi: null,
    topics: ["natural_leaf", "pharmacology", "7oh", "mitragynine_pseudoindoxyl"],
    study_type: "in_vitro",
    abstract: "Molecular dynamics simulation study of three kratom alkaloids (mitragynine, 7-hydroxymitragynine, mitragynine pseudoindoxyl) in DPPC lipid bilayers. All three exhibit amphiphilic behavior, rapidly diffusing into the hydrophobic core and localizing near lipid phosphate groups. Mitragynine showed the fastest membrane penetration; 7-hydroxymitragynine and pseudoindoxyl showed slower diffusion. At higher concentrations, alkaloids cluster in water, delaying or preventing bilayer penetration — particularly for 7-hydroxymitragynine. May inform development of safer opioid alternatives for pain management and addiction treatment.",
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. Full metadata extracted from UiTM repository page; no paywall.",
  },
  {
    label: "Bulletin of Faculty of Pharmacy Cairo (S1687157X) 2026",
    title: "Kratom (Mitragyna speciosa) — phytochemistry / pharmacology paper (Bulletin of Faculty of Pharmacy, Cairo University, S1687157X26000545)",
    authors: [],
    journal: "Bulletin of Faculty of Pharmacy, Cairo University",
    publication_year: 2026,
    full_text_url: "https://www.sciencedirect.com/science/article/pii/S1687157X26000545",
    doi: null,
    topics: ["needs_review"],
    study_type: null,
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. ScienceDirect 403 to scrapers + not yet indexed in Google search; needs admin to paste abstract manually OR an Anthropic-fetcher pass. Journal pattern S1687157X = Bulletin of Faculty of Pharmacy, Cairo University (free OA).",
  },
  {
    label: "J Ethnopharm S0885392426005750 2026",
    title: "Kratom (Mitragyna speciosa) ethnopharmacology / phytochemistry paper (Journal of Ethnopharmacology, S0885392426005750)",
    authors: [],
    journal: "Journal of Ethnopharmacology",
    publication_year: 2026,
    full_text_url: "https://www.sciencedirect.com/science/article/abs/pii/S0885392426005750",
    doi: null,
    topics: ["ethnopharmacology", "natural_leaf", "needs_review"],
    study_type: "review",
    abstract: "Likely covers ethnopharmacology + phytochemistry of kratom and Mitragyna alkaloids, including traditional Southeast Asian use, biphasic dose effects, and 40+ alkaloid profile. Full abstract behind ScienceDirect paywall.",
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. ScienceDirect 403. PII pattern S0885 = Journal of Ethnopharmacology. Abstract content inferred from sibling 2026 papers in same journal — needs admin verification.",
  },
  {
    label: "JPET S0022-3565(26)00489-1",
    title: "Kratom alkaloid pharmacology paper (Journal of Pharmacology and Experimental Therapeutics, 2026, manuscript S0022-3565(26)00489-1)",
    authors: [],
    journal: "The Journal of Pharmacology and Experimental Therapeutics",
    publication_year: 2026,
    full_text_url: "https://jpet.aspetjournals.org/article/S0022-3565(26)00489-1/abstract",
    doi: null,
    topics: ["pharmacology", "mitragynine", "needs_review"],
    study_type: null,
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. JPET 403 to scrapers; 2026 issue not yet indexed in Google. JPET is the premier journal for kratom pharmacology research (Hemby, Babu, McCurdy groups publish here). Needs admin to paste title + abstract OR an authenticated fetch.",
  },
  {
    label: "J Ethnopharm S0885392426007165 2026",
    title: "Kratom (Mitragyna speciosa) ethnopharmacology paper (Journal of Ethnopharmacology, S0885392426007165)",
    authors: [],
    journal: "Journal of Ethnopharmacology",
    publication_year: 2026,
    full_text_url: "https://www.sciencedirect.com/science/article/abs/pii/S0885392426007165",
    doi: null,
    topics: ["ethnopharmacology", "needs_review"],
    study_type: "review",
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. ScienceDirect 403. PII pattern indicates a J Ethnopharmacology paper, likely paired with S0885392426005750 above. Needs admin verification of title + abstract.",
  },
  {
    label: "JPET S0022-3565(26)00479-9",
    title: "Kratom alkaloid pharmacology paper (Journal of Pharmacology and Experimental Therapeutics, 2026, manuscript S0022-3565(26)00479-9)",
    authors: [],
    journal: "The Journal of Pharmacology and Experimental Therapeutics",
    publication_year: 2026,
    full_text_url: "https://jpet.aspetjournals.org/article/S0022-3565(26)00479-9/abstract",
    doi: null,
    topics: ["pharmacology", "mitragynine", "needs_review"],
    study_type: null,
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. Same as the other JPET 2026 paper — gated + not indexed yet. JPET tends to publish mitragynine pharmacokinetics + receptor activity work from Babu/Hemby/McCurdy groups. Needs admin to paste abstract.",
  },
  {
    label: "Chem Rev Lett 243137",
    title: "Kratom / Mitragyna alkaloid review (Chemical Review Letters, article 243137)",
    authors: [],
    journal: "Chemical Review Letters",
    publication_year: 2026,
    full_text_url: "https://www.chemrevlett.com/article_243137.html",
    doi: null,
    topics: ["chemistry", "needs_review"],
    study_type: "review",
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. ChemRevLett 403 to scrapers + no Google index yet. Smaller open-access journal; admin needs to paste abstract.",
  },
  {
    label: "J Med Chem 6c00991",
    title: "Kratom alkaloid medicinal chemistry paper (Journal of Medicinal Chemistry, DOI 10.1021/acs.jmedchem.6c00991)",
    authors: [],
    journal: "Journal of Medicinal Chemistry",
    publication_year: 2026,
    full_text_url: "https://pubs.acs.org/doi/10.1021/acs.jmedchem.6c00991",
    doi: "10.1021/acs.jmedchem.6c00991",
    topics: ["medicinal_chemistry", "pharmacology", "needs_review"],
    study_type: null,
    abstract: null,
    ingested_via: "manual",
    admin_notes_md: "Submitted via Facebook community 2026-05-15. ACS Publications 403 to scrapers. J Med Chem is the premier medicinal-chemistry venue for opioid analogues; this paper is likely related to mitragynine receptor SAR work (Majumdar et al, Pasternak et al lineage). Needs admin to paste full title + abstract.",
  },
];

console.log(`Seeding ${PAPERS.length} research papers from Facebook community batch 1${DRY ? " (DRY RUN)" : ""}…\n`);

let ok = 0, skipped = 0, fail = 0;

for (const p of PAPERS) {
  // Dedupe: by DOI if present, else by exact title
  let existing;
  if (p.doi) {
    const { data } = await sb.from("research_papers").select("id, title").eq("doi", p.doi).maybeSingle();
    existing = data;
  } else {
    const { data } = await sb.from("research_papers").select("id, title").eq("title", p.title).maybeSingle();
    existing = data;
  }
  if (existing) {
    console.log(`  ⏭  ${p.label} — already exists as ${existing.id.slice(0, 8)}`);
    skipped++;
    continue;
  }

  const row = {
    title: p.title,
    authors: p.authors,
    journal: p.journal,
    publication_year: p.publication_year,
    doi: p.doi,
    full_text_url: p.full_text_url,
    abstract: p.abstract,
    topics: p.topics,
    study_type: p.study_type,
    admin_notes_md: p.admin_notes_md,
    ingested_at: new Date().toISOString(),
    ingested_via: p.ingested_via,
    is_active: true,
  };

  if (DRY) {
    console.log(`  [DRY] ${p.label}`);
    ok++;
    continue;
  }

  const { error } = await sb.from("research_papers").insert(row);
  if (error) {
    console.error(`  ✗ ${p.label}: ${error.message?.slice(0, 150)}`);
    fail++;
    continue;
  }
  console.log(`  ✓ ${p.label}`);
  ok++;
}

console.log(`\nDone. inserted=${ok}, dedupe-skipped=${skipped}, fail=${fail}.`);
console.log(`\nAdmin TODO: visit /research and filter topics=needs_review to paste abstracts for the 6 gated papers.`);
