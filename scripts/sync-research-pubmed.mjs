#!/usr/bin/env node
/**
 * Sync research papers from PubMed.
 *
 * PubMed's NCBI E-utilities API is FREE, no key required, no auth.
 * We use:
 *   esearch.fcgi → list PMIDs matching a query
 *   efetch.fcgi  → pull full metadata + abstract per PMID (XML)
 *
 * Rate limits: 3 req/sec without key, 10 req/sec with a free NCBI key.
 * We pace at 1 req/sec to be safe and not get banned.
 *
 * Query strategy: rotate across kratom-specific search terms to cover
 * the literature surface. Each run pulls newest 100 papers per query.
 *
 * Run:
 *   node --env-file=.env.local scripts/sync-research-pubmed.mjs
 *   node --env-file=.env.local scripts/sync-research-pubmed.mjs --limit 20
 *   node --env-file=.env.local scripts/sync-research-pubmed.mjs --dry-run
 */
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const arg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const LIMIT = parseInt(arg("--limit") ?? "100");
const DRY_RUN = args.includes("--dry-run");

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NCBI_KEY = process.env.NCBI_API_KEY; // optional, just makes pacing faster
if (!SB_URL || !SB_KEY) { console.error("Missing Supabase env"); process.exit(1); }

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERIES = [
  "kratom",
  "mitragyna speciosa",
  "mitragynine",
  "7-hydroxymitragynine",
  "7-OH-mitragynine",
];

const TOPIC_RX = [
  { tag: "natural_leaf", rx: /\bnatural\s+(leaf|kratom)|traditional\s+use|whole\s+plant\b/i },
  { tag: "7oh", rx: /\b7-?hydroxymitragynine|7-?oh|enriched\s+(?:product|extract)\b/i },
  { tag: "addiction", rx: /\baddict|depend|withdraw|substance\s+use\s+disorder|opioid\s+use\s+disorder|oud\b/i },
  { tag: "harm_reduction", rx: /\bharm\s+reduction|substitut|tapering|maintenance|naloxone\b/i },
  { tag: "pharmacology", rx: /\bpharmacolog|receptor|alkaloid|binding|metabolism|cyp\d|pharmacokinetic\b/i },
  { tag: "toxicology", rx: /\btoxicit|hepatotox|cardiotox|seizure|fatal|overdose|poisoning\b/i },
  { tag: "regulation", rx: /\bregulat|polic|legal|scheduled|controlled\s+substance|legislation\b/i },
  { tag: "survey", rx: /\bsurvey|self-report|questionnaire|n\s*=\s*\d+\s*(participants|respondents)\b/i },
  { tag: "review", rx: /\b(systematic\s+review|meta-analysis|narrative\s+review|scoping\s+review)\b/i },
  { tag: "case_report", rx: /\bcase\s+report|case\s+series\b/i },
  { tag: "in_vitro", rx: /\bin\s+vitro|cell\s+culture|hek293|cho\s+cells\b/i },
  { tag: "animal_study", rx: /\bmurine|mouse|mice|rat|rodent|primate|zebrafish\b/i },
  { tag: "clinical", rx: /\brandomized|placebo[- ]controlled|double[- ]blind|clinical\s+trial\b/i },
];

function detectTopics(text) {
  const found = new Set();
  for (const t of TOPIC_RX) {
    if (t.rx.test(text)) found.add(t.tag);
  }
  return [...found];
}

function detectStudyType(text) {
  if (/\b(randomized|placebo[- ]controlled|double[- ]blind|rct)\b/i.test(text)) return "rct";
  if (/\b(systematic\s+review|meta-analysis)\b/i.test(text)) return "review";
  if (/\b(case\s+report|case\s+series)\b/i.test(text)) return "case_report";
  if (/\bin\s+vitro\b/i.test(text)) return "in_vitro";
  if (/\b(murine|mouse|mice|rat|rodent)\b/i.test(text)) return "animal";
  if (/\b(survey|cross-sectional|self-report)\b/i.test(text)) return "survey";
  if (/\b(observational|cohort|retrospective|case-control)\b/i.test(text)) return "observational";
  return null;
}

async function esearchPmids(query, retmax = 100) {
  const params = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmax: String(retmax),
    retmode: "json",
    sort: "pub_date",
  });
  if (NCBI_KEY) params.set("api_key", NCBI_KEY);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`esearch ${res.status}`);
  const data = await res.json();
  return data?.esearchresult?.idlist ?? [];
}

async function efetchSummary(pmids) {
  // E-summary returns lighter metadata; we use efetch+xml for full abstract
  const params = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "xml",
  });
  if (NCBI_KEY) params.set("api_key", NCBI_KEY);
  const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`efetch ${res.status}`);
  return res.text();
}

// Naive XML extractor — PubMed XML is verbose but predictable
function extractArticles(xml) {
  const articles = [];
  const articleRx = /<PubmedArticle\b[^>]*>([\s\S]*?)<\/PubmedArticle>/g;
  let m;
  while ((m = articleRx.exec(xml))) {
    const block = m[1];
    const get = (rx) => {
      const r = block.match(rx);
      if (!r) return null;
      return r[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    };
    const pmid = get(/<PMID[^>]*>(\d+)<\/PMID>/);
    const title = get(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
    // Abstract may be split into AbstractText elements with labels
    const abstractBlocks = [...block.matchAll(/<AbstractText\b[^>]*>([\s\S]*?)<\/AbstractText>/g)];
    const abstract = abstractBlocks
      .map((a) => a[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n") || null;
    const journal = get(/<Title>([^<]+)<\/Title>/);
    const journalAbbr = get(/<ISOAbbreviation>([^<]+)<\/ISOAbbreviation>/);
    const year = get(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
    const month = get(/<PubDate>[\s\S]*?<Month>([^<]+)<\/Month>/);
    const day = get(/<PubDate>[\s\S]*?<Day>(\d{1,2})<\/Day>/);
    const doi = get(/<ELocationID[^>]*EIdType="doi"[^>]*>([^<]+)<\/ELocationID>/);
    // Authors
    const authorMatches = [...block.matchAll(/<Author\b[^>]*>([\s\S]*?)<\/Author>/g)];
    const authors = authorMatches.map((a) => {
      const last = a[1].match(/<LastName>([^<]+)<\/LastName>/)?.[1] ?? "";
      const initials = a[1].match(/<Initials>([^<]+)<\/Initials>/)?.[1] ?? "";
      return `${last}${initials ? " " + initials : ""}`.trim();
    }).filter(Boolean);
    // Publication date parsed
    let publicationDate = null;
    if (year) {
      const monthIdx = month
        ? (isNaN(parseInt(month)) ? ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(month.toLowerCase().slice(0, 3)) + 1 : parseInt(month))
        : 1;
      const dayNum = day ? parseInt(day) : 1;
      const monthStr = String(monthIdx > 0 ? monthIdx : 1).padStart(2, "0");
      const dayStr = String(dayNum || 1).padStart(2, "0");
      publicationDate = `${year}-${monthStr}-${dayStr}`;
    }
    articles.push({ pmid, title, abstract, journal, journalAbbr, year: year ? parseInt(year) : null, publicationDate, doi, authors });
  }
  return articles;
}

// ---------- main ----------
console.log(`Syncing PubMed research${DRY_RUN ? " [DRY RUN]" : ""}…`);
const t0 = Date.now();
const allPmids = new Set();
for (const q of QUERIES) {
  process.stdout.write(`  esearch "${q}"… `);
  try {
    const ids = await esearchPmids(q, LIMIT);
    console.log(`${ids.length} pmids`);
    for (const id of ids) allPmids.add(id);
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 60)}`);
  }
  await sleep(1100);
}
console.log(`\nUnique PMIDs across all queries: ${allPmids.size}`);

// Find which we already have to skip them
const pmidList = [...allPmids];
const { data: existing } = await sb.from("research_papers")
  .select("pubmed_id")
  .in("pubmed_id", pmidList);
const known = new Set((existing ?? []).map((r) => r.pubmed_id));
const toFetch = pmidList.filter((p) => !known.has(p));
console.log(`Already have: ${known.size}. To fetch: ${toFetch.length}.`);

if (toFetch.length === 0) {
  console.log("Nothing new.");
  process.exit(0);
}

// Fetch in batches of 50
let inserted = 0;
for (let i = 0; i < toFetch.length; i += 50) {
  const batch = toFetch.slice(i, i + 50);
  process.stdout.write(`  efetch ${i + 1}-${i + batch.length}… `);
  let xml;
  try {
    xml = await efetchSummary(batch);
  } catch (e) {
    console.log(`✗ ${e.message?.slice(0, 60)}`);
    await sleep(2000);
    continue;
  }
  const articles = extractArticles(xml);
  console.log(`parsed ${articles.length}`);

  for (const a of articles) {
    if (!a.pmid || !a.title) continue;
    const text = `${a.title}\n\n${a.abstract ?? ""}`;
    const topics = detectTopics(text);
    const studyType = detectStudyType(text);
    const distinguishesNaturalVsSynthetic = /\b(natural\s+(leaf|kratom)|whole\s+plant|traditional\s+use)/i.test(text)
      && /\b(7-?oh|7-?hydroxymitragynine|enriched|synthetic)/i.test(text);

    if (!DRY_RUN) {
      const { error } = await sb.from("research_papers").insert({
        pubmed_id: a.pmid,
        title: a.title.slice(0, 1000),
        authors: a.authors,
        journal: a.journal,
        journal_iso_abbreviation: a.journalAbbr,
        publication_year: a.year,
        publication_date: a.publicationDate,
        abstract: a.abstract,
        doi: a.doi,
        full_text_url: a.doi ? `https://doi.org/${a.doi}` : null,
        topics,
        study_type: studyType,
        ai_distinguishes_natural_vs_synthetic: distinguishesNaturalVsSynthetic,
        ingested_via: "pubmed",
      });
      if (error) {
        if (error.code !== "23505") {
          console.log(`    ✗ ${a.pmid}: ${error.message?.slice(0, 60)}`);
        }
      } else {
        inserted++;
      }
    }
  }
  await sleep(1200);
}

const elapsed = ((Date.now() - t0) / 1000 / 60).toFixed(1);
console.log(`\nDone in ${elapsed} min — ${inserted} new papers inserted.`);

try {
  await sb.from("scraper_runs").insert({
    source: "sync_research_pubmed",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    status: inserted > 0 ? "success" : "empty",
    rows_added: inserted,
    notes: `${allPmids.size} unique PMIDs across ${QUERIES.length} queries · ${inserted} new`,
  });
} catch { /* best-effort */ }
process.exit(0);
