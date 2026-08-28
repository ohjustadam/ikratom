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
    // "7-Hydroxymitragynine", "7-hydroxy mitragynine", "7-OH".
    // The lookaheads matter: "the DEA scheduled three 7-OH-RELATED substances,
    // MP, MGM-15 and MGM-16" is an accurate sentence about the compounds that
    // really were scheduled, and reading it as a claim about 7-OH itself is
    // wrong. "7-OH-related" / "7-OH-derived" describe the family, not the leaf.
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
    // Reported in the status table, but never used to FLAG a sentence. The word
    // appears in nearly every sentence we scan — "kratom-related opioids", "the
    // kratom industry", "a kratom alkaloid" — so flagging on it marks accurate
    // reporting about the MP/MGM-15/MGM-16 order as though it were a claim about
    // natural leaf. A claim that natural leaf is federally scheduled is never
    // made without naming a specific alkaloid, which the matchers above catch.
    auditable: false,
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

/* ─────────────────────────────────────────────────────────────────────────────
 * Claim detection — "does this text assert something the record contradicts?"
 *
 * Lives here, next to the ground truth it checks against, so the writers (which
 * gate on it before publishing) and the auditor (which sweeps what's already
 * published) can never drift apart. An earlier cut kept a second copy of these
 * matchers in the audit script; that duplication is exactly how a guard rots.
 * ───────────────────────────────────────────────────────────────────────────*/

// The claim must be about PLACEMENT IN A SCHEDULE. "The FDA classified 7-OH as
// an opioid" and "classified 7-OH products as dangerous" are ordinary reporting,
// not scheduling claims. "Classified" alone is far too overloaded — require the
// schedule itself as the object, or a guard that cries wolf gets ignored.
const PLACEMENT = /\bSchedule\s*(I\b|1\b|One\b)|\bemergency\s+scheduling\b|\btemporar(y|ily)\s+schedul\w+|\bplaced?\s+in(to)?\s+schedule\b/i;

// …and a federal actor, so state scheduling actions — real, common, correctly
// reported — don't read as federal ones.
const FEDERAL = /\b(DEA|Drug Enforcement|federal(ly)?|HHS|FDA|nationwide|Controlled Substances Act|CSA)\b/i;

const COMPLETED = /\b(banned|outlaw\w*|made\s+(it\s+)?illegal|is\s+now\s+illegal|became\s+illegal|placed|classified|scheduled|criminaliz\w+|took\s+effect|went\s+into\s+effect|prohibit\w*)\b/i;

// Proposal / future language — the sentence describes a plan, not a fact.
// NOTE "should" / "whether" / "argues" / "reviewing": an agency SAYING a
// substance ought to be scheduled is the single most common sentence in this
// corpus ("The FDA argues that 7-OH should be classified as a Schedule I
// controlled substance"). Reading those as completed bans produced 15 of the
// first 32 hits on a full-history sweep. Advocacy for an action is not the
// action.
const PROPOSED = /\b(propos\w+|plan(s|ned|ning)?\b|mov(e[sd]?|ing)\s+(to|kratom|it)|intend\w*|would\b|could\b|may\b|will\b|should\b|shall\b|whether\b|expect\w*|urge[sd]?|recommend\w*|request\w*|ask\w*|argu\w+|review\w+|claim(s|ed|ing)?\s+that|under\s+(federal\s+)?consideration|call(s|ed)?\s+for|seek\w*|considering|weigh\w+|pending|deadline|nearing|set\s+to|advanc\w+|oppos\w+|testimony|announce[sd]?\s+(plans|intent)|comment\s+period|if\s+(finalized|approved|enacted))\b/i;

// Negation — "traditional kratom is NOT banned federally" is accurate reporting.
const NEGATED = /\b(not\s+(yet\s+)?(been\s+)?(being\s+)?(banned|scheduled|illegal|classified|prohibited)|isn't|is\s+not|are\s+not|aren't|does\s+not|doesn't|has\s+not|hasn't|remains?\s+(legal|unscheduled|available)|still\s+legal|unscheduled|no\s+federal)\b/i;

// State-level bans are real and common (ND, MA, KS…), and correctly reported.
const STATE_LEVEL = /\b(states?|statewide|governor|legislature|lawmakers?|county|city|municipal|executive\s+order|emergency\s+order|Department\s+of\s+Public\s+Health|[A-Z][a-z]+\s+(Senate|House))\b|\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)\b/i;

// Comparison framing means the completed action belongs to a DIFFERENT
// substance and ours is only the yardstick: "the DEA classified the synthetic
// opioid O-DSMT as Schedule I in 49 days, raising concerns about a similar
// rapid scheduling of 7-OH." O-DSMT really is scheduled; the sentence makes no
// claim about 7-OH. Scoped tight (comparison word within ~80 chars of the
// scheduling verb) so it can't swallow a plain assertion.
const COMPARATIVE = /\b(similar|comparable|precedent|analogous)\b.{0,60}\bschedul|\bschedul\w+.{0,80}\b(similar|comparable|analogous)\b/i;

// Our own correction copy quotes the false claim in order to debunk it.
const ALREADY_CORRECTED = /\bCORRECT(ION|ED)\b/i;

const splitSentences = (text) =>
  String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

// "the DEA scheduled three 7-OH-RELATED substances, MP, MGM-15 and MGM-16" is
// an accurate sentence about compounds that really were scheduled. The phrase
// names the chemical family, not the leaf alkaloid, so strip those modifiers
// before deciding whether a sentence makes a claim ABOUT 7-OH itself.
const FAMILY_MODIFIER = /(7[-\s]?hydroxy[-\s]?mitragynine|7-OH)[-\s](related|derived|adjacent|like)\b/gi;
const stripFamilyPhrases = (sentence) => sentence.replace(FAMILY_MODIFIER, "those compounds");

/**
 * Find sentences asserting a federal scheduling that the record contradicts.
 *
 * @param {string} text
 * @param {object} facts  from getFederalSchedulingFacts()
 * @returns {Array<{substance: string, sentence: string}>}
 */
export function findFalseClaims(text, facts) {
  if (!text || !facts?.ok || ALREADY_CORRECTED.test(text)) return [];
  const suspect = facts.substances.filter((s) => s.status !== "scheduled");
  const matchers = SUBSTANCES.filter((s) => s.auditable !== false);
  const hits = [];
  for (const raw of splitSentences(text)) {
    const sentence = stripFamilyPhrases(raw);
    if (!PLACEMENT.test(sentence)) continue;
    if (!FEDERAL.test(sentence)) continue;
    if (!COMPLETED.test(sentence)) continue;
    if (PROPOSED.test(sentence)) continue;
    if (NEGATED.test(sentence)) continue;
    if (COMPARATIVE.test(sentence)) continue;
    if (STATE_LEVEL.test(sentence)) continue;
    for (const s of suspect) {
      const m = matchers.find((x) => x.key === s.key);
      if (m?.match.test(sentence)) hits.push({ substance: s.label, sentence: raw });
    }
  }
  return hits;
}

/**
 * One plain sentence stating what the record actually says — used to replace or
 * prefix text that would otherwise repeat a source's error.
 */
export function correctionSentence(facts) {
  if (!facts?.ok) return "";
  const sched = facts.substances.filter((s) => s.status === "scheduled");
  const prop = facts.substances.filter((s) => s.status === "proposed");
  const parts = [];
  if (sched.length) {
    parts.push(
      `Per the Federal Register, the only kratom-related substances currently in Schedule I federally are ` +
      `${sched.map((s) => s.label).join(", ")} (effective ${sched[0].effectiveOn}).`,
    );
  }
  if (prop.length) {
    parts.push(`${prop.map((s) => s.label).join(" and ")} remains a proposal only and is not federally scheduled.`);
  }
  return parts.join(" ");
}

/**
 * The publish gate. Owner rule, 2026-08-28: "even if it is the source's
 * mistake, we should not share their mistake, we should only represent the
 * truth." So no writer may persist text that asserts a scheduling the record
 * contradicts — if a regenerate can't fix it, the verified record goes FIRST
 * and what follows is explicitly framed as the source's claim.
 *
 * @returns {{ text: string, hits: Array, corrected: boolean }}
 */
export function enforceFederalTruth(text, facts, { dateStr = new Date().toISOString().slice(0, 10) } = {}) {
  const hits = findFalseClaims(text, facts);
  if (!hits.length) return { text, hits: [], corrected: false };
  const banner =
    `CORRECTION (${dateStr}): ${correctionSentence(facts)} The summary below reflects the ` +
    `source article's reporting, which conflicts with the federal record on this point.`;
  return { text: `${banner}\n\n${text}`, hits, corrected: true };
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
