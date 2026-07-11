/**
 * place-classify.mjs — keyless "is this locality an incorporated municipality?"
 *
 * The local-rep resolver only ever finds officials for places that HAVE their
 * own government (a city/town/village council + mayor). Unincorporated places —
 * Census-designated places (CDPs), unincorporated communities, hamlets — have
 * NO municipal government; their local government is the parent county/parish.
 * Trying to resolve "Poydras, LA" (a CDP in St. Bernard Parish) as municipal
 * can never succeed and just clogs the queue forever with `no-extract`.
 *
 * The old guard only caught a literal "CDP" substring in the locality string,
 * but normalizeLocality() strips "CDP" for display ("Poydras CDP" → "Poydras"),
 * so a request stored as "Poydras, LA" slipped straight past it. This resolves
 * incorporation status from Wikidata (keyless, free, no quota — standing rule 9)
 * so the class of place is detected regardless of how the string was normalized.
 *
 * Precision over recall: we only report `unincorporated` on a CONFIDENT signal.
 * Any ambiguity, a same-named incorporated place, no data, or a network error
 * returns `unknown` — callers then proceed exactly as before (never a false
 * reject of a real city).
 */

// US state / DC → Wikidata QID (fetched from Wikidata P5086, 2026-07-11).
const STATE_QID = {
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

// Type-label signals. INCORP wins over UNINCORP when a place carries both
// (a genuine city must never be rejected). "census-designated place" contains
// "place", not "city", so it never trips INCORP.
const INCORP_RE = /\b(city|town|village|borough|municipalit|township|consolidated city)\b/i;
const UNINCORP_RE = /(census-designated place|unincorporated (community|area)|\bhamlet\b|ghost town|former (settlement|municipality)|neighborhood)/i;

/** Decide place kind from a set of Wikidata P31 type labels. Pure + exported
 *  for unit testing. INCORP wins over UNINCORP so a genuine city carrying a
 *  stray CDP-ish label is never wrongly rejected; no signal → "unknown". */
export function classifyFromTypes(typeLabels) {
  const types = (typeLabels ?? []).map((t) => String(t ?? "").toLowerCase());
  if (types.some((t) => INCORP_RE.test(t))) return "incorporated";
  if (types.some((t) => UNINCORP_RE.test(t))) return "unincorporated";
  return "unknown";
}

const _cache = new Map(); // key `${state}|${name}` → result

function stripState(city) {
  return String(city ?? "").replace(/,\s*[A-Z]{2}$/i, "").replace(/\s+/g, " ").trim();
}

function saintVariants(name) {
  const v = [name];
  if (/^st\.?\s/i.test(name)) v.push(name.replace(/^st\.?\s/i, "Saint "));
  if (/^saint\s/i.test(name)) { v.push(name.replace(/^saint\s/i, "St. ")); v.push(name.replace(/^saint\s/i, "St ")); }
  return v;
}

/** Candidate Wikidata labels, RAW name first — "city"/"town" are often part of
 *  the real name ("Oklahoma City", "Jersey City"), so we never strip them up
 *  front. Only if the raw name finds nothing do we try a type-word-stripped
 *  variant to catch "City of Troy" / "Troy city" → label "Troy". */
function labelVariants(city) {
  const base = stripState(city);
  const stripped = base
    .replace(/\b(city|town|village|borough|township|parish|county|of)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const out = [...saintVariants(base)];
  if (stripped && stripped.toLowerCase() !== base.toLowerCase()) out.push(...saintVariants(stripped));
  return [...new Set(out)].filter((s) => s && s.length >= 3);
}

async function sparql(query) {
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

/**
 * @returns {Promise<{ kind: "incorporated"|"unincorporated"|"unknown", parentAdmin: string|null }>}
 */
export async function classifyUsPlace(state, city) {
  const st = String(state ?? "").trim().toUpperCase();
  const qid = STATE_QID[st];
  const variants = labelVariants(city);
  if (!qid || variants.length === 0) return { kind: "unknown", parentAdmin: null };

  const cacheKey = `${st}|${stripState(city).toLowerCase()}`;
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  let result = { kind: "unknown", parentAdmin: null };
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
    result = { kind: "unknown", parentAdmin: null }; // never false-reject on error
  }

  _cache.set(cacheKey, result);
  return result;
}
