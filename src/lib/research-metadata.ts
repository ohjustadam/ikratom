/**
 * Research-paper metadata extractor.
 *
 * Owner directive 2026-05-16: a paywalled RSC paper got submitted via
 * /research/submit and our extractor only captured the title +
 * truncated og:description. Authors, journal, year, DOI — all empty.
 * The page had standard `citation_*` meta tags but the original regex
 * only caught a single `citation_author` and missed everything else.
 *
 * Google Scholar's documented standard
 * (https://scholar.google.com/intl/en/scholar/inclusion.html#indexing)
 * is the de facto schema every academic publisher implements. We parse
 * the full set here so we get authors / journal / DOI / year for free
 * across PubMed, RSC, ACS, Springer, Wiley, Nature, Elsevier, JAMA,
 * NEJM, bioRxiv, etc. — they all expose these tags.
 *
 * For the abstract specifically, og:description is often truncated
 * mid-sentence. The full abstract typically lives in a `<section>` or
 * `<div class="abstract">` in the body, but every publisher's class
 * naming differs. Rather than maintain a regex zoo, when the captured
 * description is short we fall back to AI extraction (handled by
 * caller via `enrichAbstractWithAI`).
 */

export type ExtractedResearchMeta = {
  title: string | null;
  authors: string[];
  journal: string | null;
  journalAbbrev: string | null;
  doi: string | null;
  publicationYear: number | null;
  publicationDate: string | null; // ISO date if available
  issn: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  /** True iff the abstract looks truncated (came from og:description)
   *  and the caller should consider an AI enrichment pass. */
  abstractLikelyTruncated: boolean;
};

const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "msclkid", "twclid", "yclid", "_gl",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "mc_eid", "mc_cid", "vero_id", "vero_conv", "ref", "ref_src",
  "igshid", "ocid",
]);

/**
 * Strip tracking params from a URL. Preserves all other query params.
 * Used before storing source URLs so we don't mix the same paper twice
 * just because one user came through Facebook (fbclid=...) and another
 * came through a tweet (twclid=...).
 */
export function stripTrackingParams(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const params = u.searchParams;
    let touched = false;
    for (const key of [...params.keys()]) {
      if (TRACKING_PARAMS.has(key) || /^utm_/i.test(key)) {
        params.delete(key);
        touched = true;
      }
    }
    if (!touched) return rawUrl;
    return u.toString().replace(/\?$/, "");
  } catch {
    return rawUrl;
  }
}

/**
 * Extract all values of a repeating meta tag (e.g. citation_author).
 * Returns up to `limit` distinct values in document order.
 */
function extractAllMeta(html: string, namePattern: RegExp, limit = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Iterate every <meta ...> tag, then check if its name matches.
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!namePattern.test(tag)) continue;
    const contentMatch = /content=["']([^"']{1,1000})["']/i.exec(tag);
    if (!contentMatch) continue;
    const v = decodeEntities(contentMatch[1]).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function extractOne(html: string, namePattern: RegExp, lenCap = 4000): string | null {
  const vals = extractAllMeta(html, namePattern, 1);
  return vals[0]?.slice(0, lenCap) ?? null;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * Parse a citation_publication_date / citation_online_date / citation_date
 * value. Publishers use a mix of formats: "2026/05/12", "2026-05-12",
 * "2026", "May 12, 2026". Returns ISO date when possible, year always.
 */
function parsePubDate(raw: string | null): { year: number | null; iso: string | null } {
  if (!raw) return { year: null, iso: null };
  const yearMatch = raw.match(/(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
  // Try ISO-ish formats
  const isoMatch = raw.match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return { year, iso };
  }
  return { year, iso: null };
}

/**
 * Parse the standard academic citation_* meta tags + OG fallback + a
 * crude body-text abstract scrape. Caller decides whether to AI-enrich
 * a short abstract.
 */
export function extractResearchMetaFromHtml(html: string): ExtractedResearchMeta {
  // Title — citation_title is most authoritative; OG + <title> as fallback
  const title =
    extractOne(html, /name=["']citation_title["']/i, 500) ??
    extractOne(html, /property=["']og:title["']/i, 500) ??
    (html.match(/<title[^>]*>([^<]{3,500})<\/title>/i)?.[1]?.trim() ?? null);

  // Authors — multi-value citation_author wins; comma-split fallback to
  // citation_authors (singular tag with comma list, used by some publishers)
  let authors = extractAllMeta(html, /name=["']citation_author["']/i, 50);
  if (authors.length === 0) {
    const singleAuthors = extractOne(html, /name=["']citation_authors["']/i, 2000);
    if (singleAuthors) authors = singleAuthors.split(";").map((s) => s.trim()).filter(Boolean);
  }
  if (authors.length === 0) {
    const fallback = extractOne(html, /name=["']author["']/i, 500);
    if (fallback) authors = [fallback];
  }

  const journal = extractOne(html, /name=["']citation_journal_title["']/i, 200);
  const journalAbbrev = extractOne(html, /name=["']citation_journal_abbrev["']/i, 100);
  const doi = extractOne(html, /name=["']citation_doi["']/i, 100);

  const dateRaw =
    extractOne(html, /name=["']citation_publication_date["']/i, 50) ??
    extractOne(html, /name=["']citation_online_date["']/i, 50) ??
    extractOne(html, /name=["']citation_date["']/i, 50) ??
    extractOne(html, /name=["']citation_year["']/i, 50) ??
    extractOne(html, /name=["']dc.date["']/i, 50);
  const { year: publicationYear, iso: publicationDate } = parsePubDate(dateRaw);

  const issn = extractOne(html, /name=["']citation_issn["']/i, 20);
  const pdfUrl = extractOne(html, /name=["']citation_pdf_url["']/i, 1000);

  // Abstract — first try citation_abstract (rare), then og:description,
  // then meta-name=description. Publisher pages with full abstract in
  // body need AI extraction; we mark `abstractLikelyTruncated` so caller
  // can decide.
  let abstract =
    extractOne(html, /name=["']citation_abstract["']/i, 8000) ??
    extractOne(html, /name=["']dc\.description["']/i, 8000) ??
    extractOne(html, /property=["']og:description["']/i, 4000) ??
    extractOne(html, /name=["']description["']/i, 4000);

  // Filter placeholder strings publishers serve when no abstract exists
  // (Ovid: "Abstract was not provided for this article."). These would
  // otherwise be saved as the abstract — defeating downstream enrichment.
  const PLACEHOLDER_RES = [
    /abstract\s+(?:was\s+)?not\s+(?:provided|available)/i,
    /no\s+abstract\s+(?:available|provided)/i,
  ];
  if (abstract && PLACEHOLDER_RES.some((re) => re.test(abstract!))) {
    abstract = null;
  }

  // OG / description tags commonly truncate at 200-500 chars. If we got
  // something short, flag for AI enrichment downstream. Most legit
  // abstracts are 1000-2500 chars; <600 is a strong "truncated" signal.
  const abstractLikelyTruncated = !!abstract && abstract.length < 600;
  if (abstract) abstract = abstract.slice(0, 8000);

  return {
    title,
    authors: authors.slice(0, 50).map((a) => a.slice(0, 200)),
    journal,
    journalAbbrev,
    doi,
    publicationYear,
    publicationDate,
    issn,
    pdfUrl,
    abstract,
    abstractLikelyTruncated,
  };
}

/**
 * Strip HTML to plain readable text. Mirrors the helper used by the
 * existing admin auto-fill action — kept here so we don't depend on
 * importing a "use server" module from server-action callers.
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
