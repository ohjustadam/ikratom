// Per-topic keyword sets + a nonpartisan coarse-direction heuristic for
// multi-topic bill tagging. Used by classify-bill-topics.mjs (tag existing
// bills) and, later, by the phase-2 discovery sync. Topic keys mirror
// STANCE_TOPICS in src/lib/legislator-action-plan.ts.
//
// Matching is case-insensitive + word-boundary anchored (so "hemp" doesn't
// catch "hemisphere", "thc" doesn't catch "month"). Keep terms precise —
// false positives pollute the grid. kratom terms mirror sync-bills.mjs.

export const TOPIC_KEYWORDS = {
  kratom: ["kratom", "mitragynine", "7-hydroxymitragynine", "7-oh", "mitragyna"],
  cannabis: ["cannabis", "marijuana", "marihuana", "tetrahydrocannabinol", "thc", "dispensary", "adult-use cannabis", "recreational marijuana", "medical marijuana", "cannabis sativa"],
  hemp_cbd: ["hemp", "cannabidiol", "cbd", "delta-8", "delta-9", "industrial hemp", "hemp-derived"],
  psychedelics: ["psilocybin", "psychedelic", "mdma", "ketamine", "ibogaine", "mescaline", "dimethyltryptamine", "magic mushroom", "entheogen", "psilocin"],
  supplements: ["dietary supplement", "nutraceutical", "dshea", "herbal supplement", "vitamin supplement"],
  tobacco_vaping: ["tobacco", "nicotine", "e-cigarette", "electronic cigarette", "vaping", "vape product", "tobacco product", "smokeless tobacco"],
  alcohol: ["alcoholic beverage", "intoxicating liquor", "malt beverage", "distilled spirits", "liquor license", "alcohol content"],
};

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Return the keywords that match (word-boundary, case-insensitive) in text.
export function matchedKeywords(text, keywords) {
  const t = text.toLowerCase();
  const hits = [];
  for (const kw of keywords) {
    const re = new RegExp(`\\b${escapeRe(kw.toLowerCase())}\\b`, "i");
    if (re.test(t)) hits.push(kw);
  }
  return hits;
}

// Nonpartisan coarse direction of a bill toward a substance: does it tighten
// (ban/schedule) or loosen/regulate (legalize/license/regulate)? Deliberately
// NOT "pro/anti" — that's value-laden; this just describes the bill's vector.
const RESTRICT_RE = /\b(ban|prohibit|schedul(e|ing)|criminaliz|controlled substance|unlawful|outlaw)\b/i;
const PERMIT_RE = /\b(legaliz|decriminaliz|authoriz|permit|licens|regulat|consumer protection|age limit|labeling|standards)\b/i;

export function coarseStance(text) {
  const restrict = RESTRICT_RE.test(text);
  const permit = PERMIT_RE.test(text);
  if (restrict && !permit) return "restrictive";
  if (permit && !restrict) return "permissive";
  if (restrict && permit) return "mixed";
  return "unknown";
}
