// scripts/lib/us-states.mjs
// Shared US-state helpers for the .mjs scripts (mirror of src/lib/state-names.ts,
// which a plain-node script can't import). Core job: corroborate an AI-claimed
// locality against the article text so we NEVER publish a wrong-state alert
// (e.g. an Illinois town ordinance the model mislabeled "Rhode Island").

export const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin",
  WY: "Wyoming",
};

export const STATE_ABBRS = new Set(Object.keys(STATE_NAMES));

// Longest names first so "West Virginia" matches before "Virginia".
const NAME_ENTRIES = Object.entries(STATE_NAMES)
  .map(([abbr, name]) => [name.toLowerCase(), abbr])
  .sort((a, b) => b[0].length - a[0].length);

/**
 * Set of state abbrs whose FULL NAME appears in the text. Full-name matching
 * only — 2-letter abbreviations ("IN"/"OR"/"ME"/"OK"/"HI"…) are far too noisy
 * in prose. High precision; low recall is fine, because a missed mention just
 * routes the alert to human review instead of publishing a guessed state.
 */
export function mentionedStates(text) {
  const out = new Set();
  if (!text) return out;
  const t = String(text);
  for (const [name, abbr] of NAME_ENTRIES) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Negative lookahead for "<name> City" — "Kansas City" is in Missouri,
    // not Kansas; "Oklahoma City"/"New York City" are unambiguous but excluding
    // them just means status-quo, never a wrong flag.
    const re = new RegExp(`(^|[^a-z])${esc}(?!\\s+city\\b)([^a-z]|$)`, "i");
    if (re.test(t)) out.add(abbr);
  }
  return out;
}

/**
 * High-precision wrong-state guard. Returns { locality, corroborated }.
 *
 * We act ONLY on an unambiguous contradiction: the article explicitly names
 * exactly ONE state by its FULL NAME, and that's NOT the AI's claim → trust the
 * explicit text and flag for review. We deliberately IGNORE the noisier signals
 * (the scrape-scope state and 2-letter abbreviations) because syndicated
 * national stories surface under many state-query buckets and abbrevs are noisy
 * in prose — using them produced garbage ("Spokane → NJ"). Everything else is
 * status-quo (trust the AI/ALL). Catching the city-only case (e.g. "Normal" →
 * which state?) needs a city→state gazetteer — see PRODUCT_VISION locality notes.
 * `scopeState` is accepted for caller compatibility but intentionally unused.
 */
export function reconcileLocality({ aiLocality, text }) {
  const ai = String(aiLocality ?? "").toUpperCase();
  if (ai === "FED") return { locality: "FED", corroborated: true };
  const aiAbbr = STATE_ABBRS.has(ai) ? ai : null;
  const mentioned = mentionedStates(text);

  if (mentioned.size === 1 && aiAbbr && !mentioned.has(aiAbbr)) {
    return { locality: [...mentioned][0], corroborated: false };
  }
  if (ai === "ALL") return { locality: "ALL", corroborated: true };
  return { locality: aiAbbr ?? "ALL", corroborated: true };
}
