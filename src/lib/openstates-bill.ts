/**
 * Fetch one bill's full detail from OpenStates for the detail page.
 *
 * Returns the additional fields our daily sync doesn't capture:
 *   - abstracts[]    — multiple summary versions (legislative + LRO)
 *   - sources[]      — direct links to state-legislature PDFs / pages
 *   - actions[]      — full chronological action history
 *   - sponsorships[] — bill author + cosponsors with party + district
 *   - versions[]     — link to the actual bill text PDF, including
 *                       updated versions after committee amendments
 *
 * Quota-conscious:
 *   - OpenStates free tier = 250 calls/day. The daily cron uses most.
 *   - We cache each bill detail for 1 hour via Next.js `fetch` cache,
 *     so a single bill page only makes one upstream request per hour
 *     regardless of how many visitors hit it.
 *   - Returns null on quota / network failure so the page still
 *     renders with whatever's in the DB.
 */

export type OpenStatesActionRow = {
  date: string;
  description: string;
  classification: string[];
  organization: { name: string };
};
export type OpenStatesSponsor = {
  name: string;
  primary: boolean;
  classification: string;
  party: string | null;
};
export type OpenStatesSource = { url: string; note: string | null };
export type OpenStatesVersion = {
  date: string;
  note: string;
  links: { url: string; media_type: string }[];
};
export type OpenStatesBillDetail = {
  identifier: string;
  title: string;
  abstracts: { abstract: string; note: string | null }[];
  sources: OpenStatesSource[];
  actions: OpenStatesActionRow[];
  sponsorships: OpenStatesSponsor[];
  versions: OpenStatesVersion[];
  openstatesUrl: string;
};

/**
 * Fetch detail by (state, bill_number). Most of our DB rows have these
 * fields; the OpenStates v3 query is `/bills?jurisdiction=ok&q=<id>`.
 *
 * Returns null on missing data, network error, or quota-exhausted.
 */
export async function fetchOpenStatesBillDetail(
  state: string,
  billNumber: string,
): Promise<OpenStatesBillDetail | null> {
  const apiKey = process.env.OPENSTATES_API_KEY;
  if (!apiKey) return null;

  const url = new URL("https://v3.openstates.org/bills");
  url.searchParams.set("jurisdiction", state.toLowerCase());
  url.searchParams.set("q", billNumber);
  url.searchParams.set("per_page", "5");
  url.searchParams.set(
    "include",
    "abstracts,sources,actions,sponsorships,versions",
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      // Next.js fetch cache — 1 hour. Per-URL, so different bills don't share.
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  let data;
  try {
    data = (await res.json()) as {
      results?: Array<{
        identifier: string;
        title: string;
        abstracts?: { abstract: string; note?: string | null }[];
        sources?: { url: string; note?: string | null }[];
        actions?: OpenStatesActionRow[];
        sponsorships?: OpenStatesSponsor[];
        versions?: OpenStatesVersion[];
        openstates_url?: string;
      }>;
    };
  } catch {
    return null;
  }

  // Find the exact match — q matching is fuzzy, identifier may differ
  // by spacing or punctuation
  const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  const want = norm(billNumber);
  const match = data.results?.find((b) => norm(b.identifier) === want);
  if (!match) return null;

  return {
    identifier: match.identifier,
    title: match.title,
    abstracts: (match.abstracts ?? []).map((a) => ({
      abstract: a.abstract,
      note: a.note ?? null,
    })),
    sources: (match.sources ?? []).map((s) => ({
      url: s.url,
      note: s.note ?? null,
    })),
    actions: match.actions ?? [],
    sponsorships: match.sponsorships ?? [],
    versions: match.versions ?? [],
    openstatesUrl: match.openstates_url ?? "",
  };
}
