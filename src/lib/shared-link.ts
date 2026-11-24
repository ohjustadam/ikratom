/**
 * Turn a link someone shared or pasted into the spellings we may have stored
 * it under, so "do we already have this story?" can be answered with an exact
 * index lookup instead of a fuzzy search.
 *
 * The same article arrives as https or http, with or without "www.", with or
 * without a trailing slash, and carrying tracking parameters (utm_*, fbclid,
 * gclid...). None of those change the story. Everything else in the query
 * string is kept, because some publishers put the article id there.
 */

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|smid|ocid)$/i;

/** The first http(s) URL in a shared text, or null. Android apps often put the link in `text`. */
export function firstUrl(text: string | null | undefined): string | null {
  const m = String(text ?? "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,;!?]+$/, "") : null;
}

/** Up to 8 stored-URL candidates for one shared link, or [] if it isn't a usable web link. */
export function linkVariants(raw: string | null | undefined): string[] {
  const s = firstUrl(raw);
  if (!s || s.length > 1000) return [];
  let u: URL;
  try { u = new URL(s); } catch { return []; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return [];
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".")) return [];

  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const query = u.searchParams.toString();
  const path = u.pathname.replace(/\/+$/, "");
  const tails = [`${path}${query ? `?${query}` : ""}`, `${path}/${query ? `?${query}` : ""}`];
  const out = new Set<string>();
  // The original spelling first: it is the likeliest exact match.
  out.add(s);
  for (const scheme of ["https", "http"]) for (const h of [host, `www.${host}`]) for (const t of tails) {
    out.add(`${scheme}://${h}${t}`);
  }
  return [...out].slice(0, 9);
}
