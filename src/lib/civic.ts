/**
 * District lookup via the US Census Geocoder.
 * Free, no API key, government-maintained — replaced Google Civic Info v2
 * which Google sunset (returns 404 / "Method not found" as of mid-2025).
 *
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/address";

export type CivicDistricts = {
  congressional_district: string | null;
  state_senate_district: string | null;
  state_house_district: string | null;
  city: string | null;        // e.g. "Tulsa"
  county: string | null;      // e.g. "Tulsa County"
};

type CensusGeo = { BASENAME?: string; NAME?: string };
type CensusMatch = { geographies?: Record<string, CensusGeo[]> };
type CensusResponse = { result?: { addressMatches?: CensusMatch[] } };

/**
 * Look up state + federal districts for a US address.
 * Returns nulls if the lookup fails — caller decides how to handle.
 */
export async function getDistrictsForAddress(parts: {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}): Promise<CivicDistricts> {
  const empty: CivicDistricts = {
    congressional_district: null,
    state_senate_district: null,
    state_house_district: null,
    city: null,
    county: null,
  };

  if (!parts.street || !parts.city || !parts.state) return empty;

  const url = new URL(ENDPOINT);
  url.searchParams.set("street", parts.street.slice(0, 100));
  url.searchParams.set("city", parts.city.slice(0, 80));
  url.searchParams.set("state", parts.state);
  if (parts.zip) url.searchParams.set("zip", parts.zip.slice(0, 10));
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("vintage", "Current_Current");
  url.searchParams.set("format", "json");

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    console.error("[civic] Census fetch failed:", e);
    return empty;
  }

  if (!res.ok) {
    console.error("[civic] Census non-OK:", res.status);
    return empty;
  }

  const data = (await res.json()) as CensusResponse;
  const match = data.result?.addressMatches?.[0];
  if (!match) {
    console.warn("[civic] Census: no address match for", parts);
    return empty;
  }

  const geos = match.geographies ?? {};
  const out = { ...empty };

  // Keys are versioned ("119th Congressional Districts", "2024 State Legislative
  // Districts - Upper", etc.). Match by pattern for forward compatibility.
  for (const [key, val] of Object.entries(geos)) {
    const first = val?.[0];
    const v = first?.BASENAME ?? null;
    if (!v) continue;
    if (/Congressional Districts?$/i.test(key)) out.congressional_district = v;
    else if (/State Legislative Districts.*Upper/i.test(key)) out.state_senate_district = v;
    else if (/State Legislative Districts.*Lower/i.test(key)) out.state_house_district = v;
    else if (/^Incorporated Places$/i.test(key)) out.city = first?.NAME?.replace(/ (city|town|village)$/i, "") ?? v;
    else if (/^Counties$/i.test(key)) out.county = first?.NAME ?? `${v} County`;
  }

  return out;
}
