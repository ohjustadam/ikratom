/**
 * DOI-based research-paper metadata fallback chain.
 *
 * When a publisher landing page is a JS-rendered SPA (Ovid, Wiley
 * preview portals, some Springer subs), the regex extractor + AI
 * scrape can't see the abstract because it's not in the initial HTML.
 * For those, a DOI lookup against free metadata APIs typically wins:
 *
 *   1. CrossRef — the DOI registrar. Has structured author + journal +
 *      sometimes abstract. Always tries.
 *   2. OpenAlex — has 250M+ papers, often fills in PMID + open-access
 *      links + abstract (when other sources are silent).
 *   3. PubMed E-utilities — biomedical bias. Has the actual structured
 *      abstract for most medical journal papers, even when publisher
 *      pages don't.
 *
 * All three are FREE, no API key required. Polite-pool entry via the
 * mailto contact in the User-Agent.
 *
 * This module does NOT touch the DB. Callers (submit-actions.ts,
 * autofill-actions.ts) decide what to persist.
 */

const UA = "iKratom Research Bot (mailto:support@ikratom.org)";
const FETCH_TIMEOUT_MS = 15_000;

export type DoiLookupResult = {
  abstract: string | null;
  authors: string[];
  journal: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  pmid: string | null;
  doi: string;
  /** Which sources we successfully reached + which produced the abstract. */
  sources_tried: string[];
  abstract_source: string | null;
};

/**
 * Detect a DOI in a URL or anywhere in HTML.
 * DOI prefix is "10." followed by digits + a slash.
 */
const DOI_RE = /10\.\d{3,9}\/[-._;()/:A-Z0-9]+/i;

export function extractDoi(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(DOI_RE);
  if (!m) return null;
  // Strip trailing punctuation a DOI shouldn't have
  return m[0].replace(/[.,;:)\]>]+$/, "").toLowerCase();
}

/**
 * Some publisher pages embed the literal string "Abstract was not
 * provided for this article" (Ovid does this in og:description) which
 * is a placeholder, not an abstract. Detect + treat as null.
 */
const PLACEHOLDER_PATTERNS = [
  /abstract\s+(?:was\s+)?not\s+(?:provided|available)/i,
  /no\s+abstract\s+(?:available|provided)/i,
  /abstract\s*:\s*-+\s*$/i,
];

export function isAbstractPlaceholder(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length < 30) return true;
  return PLACEHOLDER_PATTERNS.some((re) => re.test(t));
}

/**
 * Main entry point. Tries each source in order; merges results so the
 * first non-empty value for each field wins. Returns whichever source
 * was the first to produce a real abstract.
 */
export async function lookupByDoi(doi: string): Promise<DoiLookupResult> {
  const result: DoiLookupResult = {
    abstract: null,
    authors: [],
    journal: null,
    publicationYear: null,
    publicationDate: null,
    pmid: null,
    doi: doi.toLowerCase(),
    sources_tried: [],
    abstract_source: null,
  };

  // CrossRef
  try {
    const cr = await fetchCrossRef(doi);
    if (cr) {
      result.sources_tried.push("crossref");
      if (cr.authors.length && !result.authors.length) result.authors = cr.authors;
      if (cr.journal && !result.journal) result.journal = cr.journal;
      if (cr.publicationYear && !result.publicationYear) result.publicationYear = cr.publicationYear;
      if (cr.publicationDate && !result.publicationDate) result.publicationDate = cr.publicationDate;
      if (cr.abstract && !isAbstractPlaceholder(cr.abstract)) {
        result.abstract = cr.abstract;
        result.abstract_source = "crossref";
      }
    }
  } catch { /* continue */ }

  // OpenAlex
  try {
    const oa = await fetchOpenAlex(doi);
    if (oa) {
      result.sources_tried.push("openalex");
      if (oa.authors.length && !result.authors.length) result.authors = oa.authors;
      if (oa.journal && !result.journal) result.journal = oa.journal;
      if (oa.publicationYear && !result.publicationYear) result.publicationYear = oa.publicationYear;
      if (oa.publicationDate && !result.publicationDate) result.publicationDate = oa.publicationDate;
      if (oa.pmid && !result.pmid) result.pmid = oa.pmid;
      if (oa.abstract && !isAbstractPlaceholder(oa.abstract) && !result.abstract) {
        result.abstract = oa.abstract;
        result.abstract_source = "openalex";
      }
    }
  } catch { /* continue */ }

  // PubMed (only if we got a PMID from OpenAlex or CrossRef)
  if (result.pmid) {
    try {
      const pm = await fetchPubMed(result.pmid);
      if (pm) {
        result.sources_tried.push("pubmed");
        if (pm.abstract && !isAbstractPlaceholder(pm.abstract) && !result.abstract) {
          result.abstract = pm.abstract;
          result.abstract_source = "pubmed";
        }
      }
    } catch { /* continue */ }
  }

  return result;
}

// ── CrossRef
type RawCrossRef = {
  abstract: string | null;
  authors: string[];
  journal: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
};

async function fetchCrossRef(doi: string): Promise<RawCrossRef | null> {
  const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) return null;
  type CrossRefResponse = {
    message?: {
      abstract?: string;
      author?: Array<{ given?: string; family?: string }>;
      "container-title"?: string[];
      "short-container-title"?: string[];
      published?: { "date-parts"?: number[][] };
      "published-online"?: { "date-parts"?: number[][] };
      "published-print"?: { "date-parts"?: number[][] };
    };
  };
  const j = await r.json() as CrossRefResponse;
  const msg = j?.message;
  if (!msg) return null;

  // CrossRef abstracts come wrapped in jats:p or <p> XML — strip tags.
  const rawAbstract = msg.abstract ?? null;
  const abstract = rawAbstract ? rawAbstract.replace(/<[^>]+>/g, "").trim() : null;

  const authors: string[] = (msg.author ?? [])
    .map((a) => [a.given, a.family].filter(Boolean).join(" ").trim())
    .filter((s): s is string => !!s && s.length > 0);

  const journal = msg["container-title"]?.[0] ?? msg["short-container-title"]?.[0] ?? null;

  const dateParts =
    msg["published-print"]?.["date-parts"]?.[0] ??
    msg["published-online"]?.["date-parts"]?.[0] ??
    msg.published?.["date-parts"]?.[0];
  const publicationYear = Array.isArray(dateParts) && typeof dateParts[0] === "number" ? dateParts[0] : null;
  const publicationDate =
    Array.isArray(dateParts) && dateParts.length >= 3
      ? `${dateParts[0]}-${String(dateParts[1]).padStart(2, "0")}-${String(dateParts[2]).padStart(2, "0")}`
      : Array.isArray(dateParts) && dateParts.length === 2
        ? `${dateParts[0]}-${String(dateParts[1]).padStart(2, "0")}-01`
        : null;

  return { abstract, authors, journal, publicationYear, publicationDate };
}

// ── OpenAlex
type RawOpenAlex = {
  abstract: string | null;
  authors: string[];
  journal: string | null;
  publicationYear: number | null;
  publicationDate: string | null;
  pmid: string | null;
};

async function fetchOpenAlex(doi: string): Promise<RawOpenAlex | null> {
  const r = await fetch(`https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!r.ok) return null;
  type OpenAlexResponse = {
    abstract_inverted_index?: Record<string, number[]> | null;
    authorships?: Array<{ author?: { display_name?: string } }>;
    primary_location?: { source?: { display_name?: string } };
    publication_year?: number;
    publication_date?: string;
    ids?: { pmid?: string };
  };
  const j = await r.json() as OpenAlexResponse;

  // OpenAlex stores abstracts as inverted index: word → [positions].
  // Reconstruct the text by sorting positions.
  let abstract: string | null = null;
  if (j.abstract_inverted_index && typeof j.abstract_inverted_index === "object") {
    const positions: Array<[number, string]> = [];
    for (const [word, posList] of Object.entries(j.abstract_inverted_index)) {
      if (Array.isArray(posList)) {
        for (const pos of posList) {
          if (typeof pos === "number") positions.push([pos, word]);
        }
      }
    }
    positions.sort((a, b) => a[0] - b[0]);
    const reconstructed = positions.map(([, w]) => w).join(" ").trim();
    if (reconstructed.length > 30) abstract = reconstructed;
  }

  const authors = (j.authorships ?? [])
    .map((a) => a.author?.display_name)
    .filter((s): s is string => !!s);

  const journal = j.primary_location?.source?.display_name ?? null;
  const publicationYear = typeof j.publication_year === "number" ? j.publication_year : null;
  const publicationDate = j.publication_date ?? null;

  // OpenAlex stores PMID as a URL — strip to numeric.
  let pmid: string | null = null;
  if (j.ids?.pmid && typeof j.ids.pmid === "string") {
    const m = j.ids.pmid.match(/(\d+)\s*$/);
    if (m) pmid = m[1];
  }

  return { abstract, authors, journal, publicationYear, publicationDate, pmid };
}

// ── PubMed E-utilities (efetch returns plain-text format)
async function fetchPubMed(pmid: string): Promise<{ abstract: string | null } | null> {
  const r = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&rettype=abstract&retmode=text`,
    {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    },
  );
  if (!r.ok) return null;
  const text = await r.text();
  // PubMed abstract format: after the author/affiliation block, the
  // abstract is the first paragraph that doesn't start with a metadata
  // tag like "DOI:" / "PMID:" / "Author information:". Extract by
  // finding the longest paragraph that looks like prose.
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 100)
    .filter((p) => !/^(DOI|PMID|PMCID|Conflict of interest|Author information|Comment in|Comment on|Erratum)/i.test(p))
    .filter((p) => !/^\d+\.\s/.test(p)); // skip "1. JournalName..."
  // Prefer the longest non-metadata paragraph as the abstract.
  paragraphs.sort((a, b) => b.length - a.length);
  const abstract = paragraphs[0] ?? null;
  return { abstract };
}
