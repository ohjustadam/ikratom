/**
 * place-classify.ts — keyless "is this locality an incorporated municipality?"
 *
 * TS twin of scripts/lib/place-classify.mjs (the batch/cloud runtime can't
 * import the Next TS module and vice-versa — this repo keeps parallel twins,
 * e.g. legistar-roster.ts / legistar-officials.mjs). Keep the two in sync.
 *
 * Used by the LIVE "AI suggest" path so clicking suggest on an unincorporated
 * place (a CDP like Poydras, LA) returns an honest "no city government — your
 * local government is the parish" message instead of the misleading "queued for
 * the next batch" note that can never resolve.
 *
 * Precision over recall: only a CONFIDENT Wikidata signal yields
 * "unincorporated". Ambiguity, a same-named city, no data, or a network error
 * returns "unknown" and the caller proceeds exactly as before.
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

const INCORP_RE = /\b(city|town|village|borough|municipalit|township|consolidated city)\b/i;
const UNINCORP_RE = /(census-designated place|unincorporated (community|area)|\bhamlet\b|ghost town|former (settlement|municipality)|neighborhood)/i;

export type PlaceKind = "incorporated" | "unincorporated" | "unknown";

export type PlaceClass = {
  kind: PlaceKind;
  parentAdmin: string | null;
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

export async function classifyUsPlace(state: string, city: string): Promise<PlaceClass> {
  const st = String(state ?? "").trim().toUpperCase();
  const qid = STATE_QID[st];
  const variants = labelVariants(city);
  if (!qid || variants.length === 0) return { kind: "unknown", parentAdmin: null };

  const cacheKey = `${st}|${stripState(city).toLowerCase()}`;
  const cached = _cache.get(cacheKey);
  if (cached) return cached;

  let result: PlaceClass = { kind: "unknown", parentAdmin: null };
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
      const admin =
        rows.map((r) => r.adminLabel?.value).find((a) => a && !/^Q\d+$/.test(a)) ?? null;

      if (kind !== "unknown") { result = { kind, parentAdmin: admin }; break; }
    }
  } catch {
    result = { kind: "unknown", parentAdmin: null };
  }

  _cache.set(cacheKey, result);
  return result;
}
