/**
 * federal-scheduling.mjs — authoritative, keyless federal scheduling status for
 * kratom-related substances, straight from the Federal Register API.
 *
 * WHY THIS EXISTS (incident 2026-08-28)
 * ------------------------------------
 * A KATU article reported that the DEA "made 7-OH illegal to sell or possess"
 * on Aug. 25, 2026 and placed it in Schedule I for two years. That never
 * happened. The DEA's Aug. 26 temporary scheduling order covers three OTHER
 * compounds (mitragynine pseudoindoxyl, MGM-15, MGM-16); 7-OH is still only a
 * PROPOSED rule with an open comment period. Our summarizer faithfully restated
 * the source's error, the policy-alert engine promoted it to a federal alert,
 * and 44 users got a push announcing a federal ban that does not exist.
 *
 * A reader caught it and emailed us. That is the wrong way to find out.
 *
 * The distinction the pipeline could not make is actually crisp in the Federal
 * Register, and it is free to check:
 *
 *   type "Rule"          + effective_on in the past  -> ACTUALLY scheduled
 *   type "Proposed Rule" / "Notice"                  -> merely PROPOSED
 *
 * So we fetch the real documents and ground the AI prompts in them, instead of
 * trusting whatever a newsroom wrote. Keyless, free, no API key, no quota —
 * consistent with the platform's free-tier-only + real-data-only rules.
 *
 * Usage:
 *   import { getFederalSchedulingFacts, groundingBlock } from "./lib/federal-scheduling.mjs";
 *   const facts = await getFederalSchedulingFacts();
 *   const block = groundingBlock(facts);   // paste into a system prompt
 *
 * Standalone:
 *   node scripts/lib/federal-scheduling.mjs        # prints the current status table
 */

const FR_API = "https://www.federalregister.gov/api/v1/documents.json";
const UA = "ikratom-federal-scheduling/1.0 (contact@ikratom.org)";

// Only look back far enough to cover the modern kratom scheduling docket. The
// CSA actions we care about all post-date 2024; older noise just costs tokens.
const SINCE = "2024-01-01";

/**
 * Substances we track, with precise matchers.
 *
 * Matching is done against the document TITLE, because CSA scheduling actions
 * always name their substances in the title ("Temporary Placement of Mitragynine
 * Pseudoindoxyl, MGM-15, and MGM-16 in Schedule I"). Body-text matching would
 * produce false positives — a 7-OH proposal *mentions* mitragynine constantly.
 *
 * The matchers must not bleed into each other: "7-hydroxymitragynine" and
 * "mitragynine pseudoindoxyl" both CONTAIN "mitragynine", so the bare
 * mitragynine matcher explicitly excludes those two contexts.
 */
const SUBSTANCES = [
  {
    key: "7-oh",
    label: "7-hydroxymitragynine (7-OH)",
    // "7-Hydroxymitragynine", "7-hydroxy mitragynine", "7-OH"
    match: /7[-\s]?hydroxy[-\s]?mitragynine|\b7-OH\b/i,
  },
  {
    key: "mitragynine-pseudoindoxyl",
    label: "mitragynine pseudoindoxyl",
    match: /mitragynine\s+pseudoindoxyl/i,
  },
  { key: "mgm-15", label: "MGM-15", match: /\bMGM[-\s]?15\b/i },
  { key: "mgm-16", label: "MGM-16", match: /\bMGM[-\s]?16\b/i },
  {
    key: "mitragynine",
    label: "mitragynine (the primary kratom alkaloid)",
    // bare "mitragynine" only — not preceded by hydroxy/7-, not followed by
    // pseudoindoxyl.
    match: /(?<!hydroxy[-\s]?)(?<!7[-\s])\bmitragynine\b(?!\s+pseudoindoxyl)/i,
  },
  {
    key: "kratom",
    label: "kratom (natural leaf)",
    match: /\bkratom\b|\bmitragyna\s+speciosa\b/i,
  },
];

/** Terms we ask the Federal Register to search, union-style. */
const SEARCH_TERMS = ["mitragynine", "kratom"];

async function frSearch(term, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams();
  params.set("conditions[term]", `"${term}"`);
  params.set("conditions[publication_date][gte]", SINCE);
  params.set("per_page", "100");
  params.set("order", "newest");
  for (const f of ["document_number", "title", "type", "publication_date", "effective_on", "html_url", "agencies"]) {
    params.append("fields[]", f);
  }
  const res = await fetchImpl(`${FR_API}?${params}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Federal Register API ${res.status} for "${term}"`);
  const json = await res.json();
  return Array.isArray(json.results) ? json.results : [];
}

/**
 * A document only proves a substance is SCHEDULED if it is a final/temporary
 * Rule whose effective date has arrived. Proposed rules and notices — however
 * confidently the press writes them up — prove only that something was
 * proposed.
 */
function isEffectiveRule(doc, now) {
  if (doc.type !== "Rule") return false;
  if (!doc.effective_on) return false;
  return new Date(`${doc.effective_on}T00:00:00Z`).getTime() <= now.getTime();
}

/** Scheduling actions only; skip unrelated FR chatter that merely says "kratom". */
function isSchedulingAction(doc) {
  return /schedul|controlled substance/i.test(doc.title || "");
}

/**
 * Fetch the current federal scheduling picture.
 *
 * Returns { checkedAt, substances: [{ key, label, status, effectiveOn, citations[] }], documents[] }
 * where status is "scheduled" | "proposed" | "none".
 *
 * Never throws on network failure — returns { ok:false } so a batch job degrades
 * to its previous (ungrounded) behaviour instead of dying. Callers should treat
 * a failed fetch as "no grounding available", not as "nothing is scheduled".
 */
export async function getFederalSchedulingFacts({ fetchImpl = fetch, now = new Date() } = {}) {
  let docs = [];
  try {
    const batches = await Promise.all(SEARCH_TERMS.map((t) => frSearch(t, { fetchImpl })));
    const seen = new Set();
    for (const batch of batches) {
      for (const d of batch) {
        if (seen.has(d.document_number)) continue;
        seen.add(d.document_number);
        docs.push(d);
      }
    }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err), checkedAt: now.toISOString(), substances: [], documents: [] };
  }

  const scheduling = docs.filter(isSchedulingAction);

  const substances = SUBSTANCES.map((s) => {
    const named = scheduling.filter((d) => s.match.test(d.title || ""));
    const effective = named.filter((d) => isEffectiveRule(d, now));
    const proposed = named.filter((d) => !isEffectiveRule(d, now));
    const status = effective.length ? "scheduled" : proposed.length ? "proposed" : "none";
    const cite = (d) => ({
      documentNumber: d.document_number,
      title: d.title,
      type: d.type,
      publicationDate: d.publication_date,
      effectiveOn: d.effective_on ?? null,
      url: d.html_url,
    });
    return {
      key: s.key,
      label: s.label,
      status,
      effectiveOn: effective[0]?.effective_on ?? null,
      citations: (effective.length ? effective : proposed).map(cite),
    };
  });

  return { ok: true, checkedAt: now.toISOString(), substances, documents: scheduling.map((d) => d.document_number) };
}

/**
 * Render the facts as a compact prompt block.
 *
 * The instruction deliberately does NOT tell the model to rewrite the article
 * into agreement with us. The article is what the publisher published, and our
 * summary must stay a faithful summary of it — silently "fixing" a source would
 * be its own kind of misinformation. What we require is that a contradiction be
 * NAMED, so the reader sees both the claim and the record.
 */
export function groundingBlock(facts) {
  if (!facts?.ok || !facts.substances.length) return "";
  const asOf = facts.checkedAt.slice(0, 10);
  const lines = facts.substances.map((s) => {
    if (s.status === "scheduled") {
      const c = s.citations[0];
      return `- ${s.label}: IS in Schedule I federally, effective ${s.effectiveOn} (Federal Register ${c?.documentNumber}).`;
    }
    if (s.status === "proposed") {
      const c = s.citations[0];
      return `- ${s.label}: NOT federally scheduled. Only a PROPOSED action exists (${c?.type}, Federal Register ${c?.documentNumber}, published ${c?.publicationDate}).`;
    }
    return `- ${s.label}: NOT federally scheduled; no federal scheduling action on record.`;
  });
  return [
    `VERIFIED FEDERAL SCHEDULING STATUS (Federal Register, checked ${asOf}):`,
    ...lines,
    "",
    "A proposed rule is NOT a ban. News outlets frequently conflate the two, and they",
    "sometimes attribute a scheduling action to the wrong substance. If the article",
    "contradicts the verified list above, still summarize what the article SAYS, but add",
    "one final sentence naming the discrepancy (for example: \"The article describes 7-OH",
    "as federally scheduled; per the Federal Register it is not.\"). Do not silently",
    "correct, and do not repeat an incorrect claim as if it were established fact.",
  ].join("\n");
}

// Standalone: print the table.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("federal-scheduling.mjs")) {
  const facts = await getFederalSchedulingFacts();
  if (!facts.ok) {
    console.error("Federal Register lookup failed:", facts.error);
    process.exit(1);
  }
  console.log(`Federal scheduling status as of ${facts.checkedAt}\n`);
  for (const s of facts.substances) {
    const flag = s.status === "scheduled" ? "SCHEDULED" : s.status === "proposed" ? "proposed " : "none     ";
    console.log(`  [${flag}] ${s.label}`);
    for (const c of s.citations) console.log(`             ${c.type} ${c.documentNumber} (${c.publicationDate}${c.effectiveOn ? `, eff ${c.effectiveOn}` : ""})`);
  }
  console.log("\n--- prompt block ---\n");
  console.log(groundingBlock(facts));
}
