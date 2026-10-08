/**
 * place-classify.ts — "is this US locality an incorporated municipality, or an
 * unincorporated place (a CDP) whose local government is the parent county?"
 *
 * TS twin of scripts/lib/place-classify.mjs (the batch/cloud runtime can't
 * import the Next TS module and vice-versa — this repo keeps parallel twins).
 * Keep the two in sync.
 *
 * Two independent, free sources — Census first, Wikidata fallback:
 *   1. US Census Bureau places API (authoritative — the Census literally DEFINES
 *      "CDP"). Needs a free CENSUS_API_KEY; the place NAME suffix ("Poydras CDP"
 *      vs "New Orleans city") is the ground-truth signal. Key-optional.
 *   2. Wikidata SPARQL (keyless). Used when Census has no key / no match, and
 *      always as the source of the parent county/parish (P131) for the
 *      "your local government is <parish>" message.
 *
 * Used by the LIVE "AI suggest" path + the batch resolver so an unincorporated
 * place (Poydras, LA) is recognized and handled honestly instead of churning.
 *
 * Precision over recall: only a CONFIDENT signal yields "unincorporated". No
 * data / network error → "unknown", and the caller proceeds exactly as before.
 */

// US state / DC → Wikidata QID (from Wikidata P5086, 2026-07-11).
const STATE_QID: Record<string, string> = {
  AL: "Q173", AK: "Q797", AZ: "Q816", AR: "Q1612", CA: "Q99", CO: "Q1261",
  CT: "Q779", DE: "Q1393", FL: "Q812", GA: "Q1428", HI: "Q782", ID: "Q1221",
  IL: "Q1204", IN: "Q1415", IA: "Q1546", KS: "Q1558", KY: "Q1603", LA: "Q1588",
  ME: "Q724", MD: "Q1391", MA: "Q771", MI: "Q1166", MN: "Q1527", MS: "Q1494",
  MO: "Q1581", MT: "Q1212", NE: "Q1553", NV: "Q1227", NH: "Q759", NJ: "Q1408",
  NM: "Q1522", NY: "Q1384", NC: "Q1454", ND: "Q1207", OH: "Q1397", OK: "Q1649",
  OR: "Q824", PA: "Q1400", RI: "Q1387", SC: "Q1456", SD: "Q1211", TN: "Q1509",
  TX: "Q1439", UT: "Q829", VT: "Q16551", VA: "Q1370", WA: "Q1223", WV: "Q1371",
  WI: "Q1537", WY: "Q1214", DC: "Q61",
};

// US state / DC → 2-digit Census FIPS code.
const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19",
  KS: "20", KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27",
  MS: "28", MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35",
  NY: "36", NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44",
  SC: "45", SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53",
  WV: "54", WI: "55", WY: "56",
};

const INCORP_RE = /\b(city|town|village|borough|municipalit|township|consolidated city)\b/i;
const UNINCORP_RE = /(census-designated place|unincorporated (community|area)|\bhamlet\b|ghost town|former (settlement|municipality)|neighborhood)/i;

export type PlaceKind = "incorporated" | "unincorporated" | "unknown";

export type PlaceClass = {
  kind: PlaceKind;
  parentAdmin: string | null;
  /** Which source decided `kind` — "census" (authoritative) | "wikidata" | null. */
  source?: "census" | "wikidata" | null;
};

/** Decide place kind from a set of Wikidata P31 type labels. Pure + exported
 *  for unit testing. INCORP wins over UNINCORP so a genuine city carrying a
 *  stray CDP-ish label is never wrongly rejected; no signal → "unknown". */
export function classifyFromTypes(typeLabels: Array<string | undefined>): PlaceKind {
  const types = (typeLabels ?? []).map((t) => String(t ?? "").toLowerCase());
  if (types.some((t) => INCORP_RE.test(t))) return "incorporated";
  if (types.some((t) => UNINCORP_RE.test(t))) return "unincorporated";
  return "unknown";
}

const _cache = new Map<string, PlaceClass>();

function stripState(city: string): string {
  return String(city ?? "").replace(/,\s*[A-Z]{2}$/i, "").replace(/\s+/g, " ").trim();
}

/** Squash a place name to a comparison key: lowercase alphanumerics only.
 *  "Oklahoma City" → "oklahomacity"; "St. Louis" → "stlouis". */
function normPlace(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Classify a Census place NAME ("Poydras CDP, Louisiana") into {placeKey, kind}
 *  from its LSAD suffix. Returns null for name shapes we don't recognize. */
export function parseCensusPlaceName(fullName: string): { placeKey: string; kind: PlaceKind } | null {
  const beforeState = String(fullName ?? "").split(",")[0]?.trim() ?? "";
  if (!beforeState) return null;
  if (/\s+CDP$/i.test(beforeState)) {
    return { placeKey: normPlace(beforeState.replace(/\s+CDP$/i, "")), kind: "unincorporated" };
  }
  const inc = beforeState.match(/\s+(city|town|village|borough|municipality|township|corporation)$/i);
  if (inc) {
    return { placeKey: normPlace(beforeState.slice(0, inc.index)), kind: "incorporated" };
  }
  return null; // e.g. Puerto Rico "comunidad"/"zona urbana" — leave to Wikidata
}

// Per-state Census place tables, cached for the process. "fail" = fetch failed
// (or no key) → treated as no-data so we fall through to Wikidata.
const _censusByState = new Map<string, Map<string, PlaceKind> | "fail">();

async function censusClassify(state: string, cityBase: string): Promise<PlaceKind> {
  const key = process.env.CENSUS_API_KEY;
  const fips = STATE_FIPS[state];
  if (!key || !fips) return "unknown";
  let table = _censusByState.get(state);
  if (!table) {
    try {
      const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME&for=place:*&in=state:${fips}&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(9000) });
      const body = await res.text();
      if (!res.ok || !body.trim().startsWith("[")) throw new Error(`census ${res.status}`);
      const rows = JSON.parse(body) as string[][];
      table = new Map<string, PlaceKind>();
      for (const row of rows.slice(1)) {
        const parsed = parseCensusPlaceName(row[0]);
        if (parsed) table.set(parsed.placeKey, parsed.kind);
      }
      _censusByState.set(state, table);
    } catch {
      _censusByState.set(state, "fail");
      return "unknown";
    }
  }
  if (table === "fail") return "unknown";
  return table.get(normPlace(cityBase)) ?? "unknown";
}

function saintVariants(name: string): string[] {
  const v = [name];
  if (/^st\.?\s/i.test(name)) v.push(name.replace(/^st\.?\s/i, "Saint "));
  if (/^saint\s/i.test(name)) {
    v.push(name.replace(/^saint\s/i, "St. "));
    v.push(name.replace(/^saint\s/i, "St "));
  }
  return v;
}

/** Candidate Wikidata labels, RAW name first — "city"/"town" are often part of
 *  the real name ("Oklahoma City", "Jersey City"), so we never strip them up
 *  front. Only if the raw name finds nothing do we try a type-word-stripped
 *  variant to catch "City of Troy" / "Troy city" → label "Troy". */
function labelVariants(city: string): string[] {
  const base = stripState(city);
  const stripped = base
    .replace(/\b(city|town|village|borough|township|parish|county|of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = [...saintVariants(base)];
  if (stripped && stripped.toLowerCase() !== base.toLowerCase()) out.push(...saintVariants(stripped));
  return [...new Set(out)].filter((s) => s && s.length >= 3);
}

async function sparql(query: string): Promise<Array<Record<string, { value: string }>>> {
  const url = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(query);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "iKratom/1.0 (+https://www.ikratom.org; contact@ikratom.org)",
      Accept: "application/sparql-results+json",
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`wikidata ${res.status}`);
  const body = await res.text();
  if (!body.trim().startsWith("{")) throw new Error("wikidata non-json");
  return JSON.parse(body).results?.bindings ?? [];
}

/** Wikidata pass: kind (from P31 types) + the parent admin (P131), used for the
 *  "your local government is <parish>" message. */
async function wikidataClassify(qid: string, variants: string[]): Promise<PlaceClass> {
  try {
    for (const label of variants) {
      const q = `SELECT ?typeLabel ?adminLabel WHERE {
  ?place rdfs:label ${JSON.stringify(label)}@en ; wdt:P31 ?type ; wdt:P131* wd:${qid} .
  OPTIONAL { ?place wdt:P131 ?admin . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 25`;
      const rows = await sparql(q);
      if (!rows.length) continue;
      const kind = classifyFromTypes(rows.map((r) => r.typeLabel?.value));
      const admin = rows.map((r) => r.adminLabel?.value).find((a) => a && !/^Q\d+$/.test(a)) ?? null;
      if (kind !== "unknown") return { kind, parentAdmin: admin, source: "wikidata" };
    }
  } catch {
    /* fall through to unknown */
  }
  return { kind: "unknown", parentAdmin: null, source: null };
}

export async function classifyUsPlace(state: string, city: string): Promise<PlaceClass> {
  const st = String(state ?? "").trim().toUpperCase();
  const qid = STATE_QID[st];
  const variants = labelVariants(city);
  if (!qid || variants.length === 0) return { kind: "unknown", parentAdmin: null, source: null };

  const cacheKey = `${st}|${stripState(city).toLowerCase()}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  // 1) Census — authoritative for the incorporated-vs-CDP question.
  const censusKind = await censusClassify(st, stripState(city));

  let result: PlaceClass;
  if (censusKind === "incorporated") {
    // No parent-admin lookup needed — we only surface the parish for CDPs.
    result = { kind: "incorporated", parentAdmin: null, source: "census" };
  } else if (censusKind === "unincorporated") {
    // Census says CDP (definitional). Wikidata only supplies the parent parish.
    const wiki = await wikidataClassify(qid, variants);
    result = { kind: "unincorporated", parentAdmin: wiki.parentAdmin, source: "census" };
  } else {
    // Census had no key / no match — trust Wikidata fully.
    result = await wikidataClassify(qid, variants);
  }

  _cache.set(cacheKey, result);
  return result;
}
