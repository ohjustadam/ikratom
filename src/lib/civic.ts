/**
 * District lookup via the US Census Geocoder, with a Nominatim fallback
 * for addresses Census doesn't have indexed (common for rural / newer
 * streets — ~25% of our user base as of 2026-05).
 *
 * Two-stage flow:
 *   1. Direct address lookup against the Census address index. Works for
 *      ~75% of US addresses.
 *   2. When that misses, geocode via Nominatim (OpenStreetMap, free, no
 *      API key, polite 1 req/sec) → lat/lng → Census coordinate-based
 *      geography lookup. Works for any address OSM knows about, which
 *      covers ~99% of the gap.
 *
 * Both stages free, no API keys. Owner directive 2026-05-17: friend's
 * Saint Bernard LA address sat in the Census-blind-spot — the fallback
 * resolves it in one round-trip without manual admin entry.
 *
 * Docs:
 *   - Census: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 *   - Nominatim: https://nominatim.org/release-docs/latest/api/Search/
 */

const ADDR_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/address";
const COORD_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

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

  // ── Stage 1: Census direct address lookup ─────────────────────────
  const stage1 = await lookupViaCensusAddress(parts);
  if (anyDistrictPopulated(stage1)) return stage1;

  // ── Stage 2: Nominatim geocode → Census coords fallback ────────────
  // Census misses ~25% of rural / unincorporated / newer addresses.
  // Nominatim (OpenStreetMap) has much wider coverage — when it returns
  // lat/lng, Census's coordinate endpoint reliably maps to districts.
  console.warn("[civic] Census direct miss, trying Nominatim fallback for", parts);
  const stage2 = await lookupViaNominatimThenCensusCoords(parts);
  if (anyDistrictPopulated(stage2)) {
    // Merge: prefer stage1 for city/county if it had them, stage2 fills
    // the district gaps.
    return {
      congressional_district: stage2.congressional_district ?? stage1.congressional_district,
      state_senate_district: stage2.state_senate_district ?? stage1.state_senate_district,
      state_house_district: stage2.state_house_district ?? stage1.state_house_district,
      city: stage1.city ?? stage2.city,
      county: stage1.county ?? stage2.county,
    };
  }
  return stage1; // empty if both stages failed
}

function anyDistrictPopulated(d: CivicDistricts): boolean {
  return !!(d.congressional_district || d.state_senate_district || d.state_house_district);
}

const EMPTY: CivicDistricts = {
  congressional_district: null,
  state_senate_district: null,
  state_house_district: null,
  city: null,
  county: null,
};

async function lookupViaCensusAddress(parts: {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}): Promise<CivicDistricts> {
  const url = new URL(ADDR_ENDPOINT);
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
    console.error("[civic] Census address fetch failed:", e);
    return { ...EMPTY };
  }
  if (!res.ok) {
    console.error("[civic] Census address non-OK:", res.status);
    return { ...EMPTY };
  }
  // Census occasionally serves a 200 with an HTML maintenance/error page
  // instead of JSON — parsing that as JSON throws. Guard so an upstream
  // outage degrades to "no districts" rather than crashing the lookup.
  let data: CensusResponse;
  try {
    data = JSON.parse(await res.text()) as CensusResponse;
  } catch {
    console.error("[civic] Census address returned non-JSON (likely an outage/error page)");
    return { ...EMPTY };
  }
  const match = data.result?.addressMatches?.[0];
  if (!match) return { ...EMPTY };
  return extractGeographies(match.geographies ?? {});
}

type NominatimResult = { lat?: string; lon?: string; display_name?: string };

async function lookupViaNominatimThenCensusCoords(parts: {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}): Promise<CivicDistricts> {
  // Try a few address shapes — different join orders work for different
  // localities. Nominatim is sensitive to commas + "County" / "Parish"
  // suffixes that Census-typed addresses often don't include.
  const stateName = parts.state; // 2-letter is enough for Nominatim
  const variants = [
    `${parts.street}, ${parts.city}, ${stateName} ${parts.zip ?? ""}`.trim(),
    `${parts.street}, ${parts.zip ?? ""}`.trim(),
    parts.zip ? `${parts.street}, ${parts.zip}` : null,
    `${parts.street}, ${stateName}`,
  ].filter(Boolean) as string[];

  let lat: number | null = null;
  let lon: number | null = null;
  for (const q of variants) {
    try {
      const u = new URL(NOMINATIM_ENDPOINT);
      u.searchParams.set("q", q);
      u.searchParams.set("format", "jsonv2");
      u.searchParams.set("limit", "1");
      u.searchParams.set("countrycodes", "us");
      const r = await fetch(u.toString(), {
        signal: AbortSignal.timeout(10_000),
        headers: {
          "User-Agent": "iKratom Civic Lookup (research@ikratom.org)",
          "Accept-Language": "en",
        },
      });
      if (!r.ok) continue;
      const j = (await r.json()) as NominatimResult[];
      if (j[0]?.lat && j[0]?.lon) {
        lat = parseFloat(j[0].lat);
        lon = parseFloat(j[0].lon);
        break;
      }
    } catch {
      // try next variant
    }
    // Nominatim TOS asks for ≤1 req/sec from non-key users.
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (lat === null || lon === null) return { ...EMPTY };

  // Coords → Census geographies (this endpoint works for any US lat/lng,
  // not limited to the address index).
  const u = new URL(COORD_ENDPOINT);
  u.searchParams.set("x", String(lon));
  u.searchParams.set("y", String(lat));
  u.searchParams.set("benchmark", "Public_AR_Current");
  u.searchParams.set("vintage", "Current_Current");
  u.searchParams.set("format", "json");
  try {
    const r = await fetch(u.toString(), {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return { ...EMPTY };
    const j = await r.json() as { result?: { geographies?: Record<string, CensusGeo[]> } };
    return extractGeographies(j?.result?.geographies ?? {});
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Strip leading zeros from numeric district segments so we match
 * legislator rows that store '9' not '09', 'Hillsborough 2' not
 * 'Hillsborough 02'. Census sometimes zero-pads to 2 digits while
 * LegiScan / OpenStates store the canonical unpadded form.
 *
 * Preserves non-numeric prefixes (NH uses county-name districts like
 * "Hillsborough 2"). Only strips zeros immediately before a digit.
 */
function stripLeadingZeros(s: string | null): string | null {
  if (!s) return s;
  return s.replace(/(^|\s)0+(\d)/g, "$1$2");
}

function extractGeographies(geos: Record<string, CensusGeo[]>): CivicDistricts {
  const out: CivicDistricts = { ...EMPTY };
  // Keys are versioned ("119th Congressional Districts", "2024 State Legislative
  // Districts - Upper", etc.). Match by pattern for forward compatibility.
  for (const [key, val] of Object.entries(geos)) {
    const first = val?.[0];
    const v = first?.BASENAME ?? null;
    if (!v) continue;
    if (/Congressional Districts?$/i.test(key)) out.congressional_district = stripLeadingZeros(v);
    else if (/State Legislative Districts.*Upper/i.test(key)) out.state_senate_district = stripLeadingZeros(v);
    else if (/State Legislative Districts.*Lower/i.test(key)) out.state_house_district = stripLeadingZeros(v);
    else if (/^Incorporated Places$/i.test(key)) out.city = first?.NAME?.replace(/ (city|town|village)$/i, "") ?? v;
    else if (/^Counties$/i.test(key)) out.county = first?.NAME ?? `${v} County`;
    // Some Census responses use "Census Designated Places" instead of
    // "Incorporated Places" for unincorporated areas (e.g. Poydras LA).
    else if (/^Census Designated Places$/i.test(key) && !out.city) {
      out.city = first?.NAME ?? v;
    }
  }
  return out;
}
