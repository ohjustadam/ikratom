/**
 * wikidata-portrait.mjs — a Wikidata photo for an official, only when the
 * person held an office IN THAT STATE.
 *
 * WHY (2026-11-18): the old query took the state but never used it. It took
 * any American with the exact name who had held any office, and a famous
 * namesake was often the only one with a photo: Speaker Kevin McCarthy showed
 * as a Normal, IL council member, a 19th-century Massachusetts congressman as
 * DC's Charles Allen, Oregon Rep. Greg Smith as Juneau's. Now one of the
 * person's positions must apply to a place inside the state (P1001 then P131*),
 * or carry an electoral district inside it (P768), and the answer must be one
 * distinct image.
 */
export const WDQS = "https://query.wikidata.org/sparql";
export const UA = "iKratom/1.0 (https://www.ikratom.org; support@ikratom.org)";

export function portraitSparql(fullName, stateAbbr) {
  const name = String(fullName ?? "").replace(/["\\]/g, " ").trim();
  const st = String(stateAbbr ?? "").toUpperCase();
  if (name.length < 4 || !/^[A-Z]{2}$/.test(st)) return null;
  return `SELECT DISTINCT ?img WHERE {
    ?p rdfs:label "${name}"@en ; wdt:P31 wd:Q5 ; wdt:P18 ?img .
    ?state wdt:P300 "US-${st}" .
    ?p p:P39 ?st . ?st ps:P39 ?pos .
    { ?pos wdt:P1001/wdt:P131* ?state } UNION { ?st pq:P768/wdt:P131* ?state }
  } LIMIT 3`;
}

/** The single distinct image, or null when there is none or more than one. */
export function pickPortrait(bindings) {
  const imgs = [...new Set((bindings ?? []).map((b) => b.img?.value).filter(Boolean))];
  return imgs.length === 1 ? imgs[0] : null;
}

/** Commons file name from either URL form, decoded, for comparing two links to one file. */
export function commonsFile(url) {
  const m = String(url ?? "").match(/Special:FilePath\/([^?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ").toLowerCase() : null;
}

/**
 * { ok, img, imgs } — ok=false means the query itself failed (keep what we have).
 * imgs is every in-state image: a person can carry two P18 photos (Keith
 * Ellison), which makes img null but still confirms either one on file.
 */
export async function stateCheckedPortrait(fullName, stateAbbr, { timeoutMs = 60_000 } = {}) {
  const q = portraitSparql(fullName, stateAbbr);
  if (!q) return { ok: true, img: null, imgs: [] };
  try {
    const res = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, img: null, imgs: [] };
    const bindings = (await res.json()).results?.bindings ?? [];
    return { ok: true, img: pickPortrait(bindings), imgs: [...new Set(bindings.map((b) => b.img?.value).filter(Boolean))] };
  } catch {
    return { ok: false, img: null, imgs: [] };
  }
}
