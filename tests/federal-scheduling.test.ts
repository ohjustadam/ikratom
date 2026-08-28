import { describe, it, expect, beforeAll } from "vitest";
import {
  getFederalSchedulingFacts,
  groundingBlock,
  findFalseClaims,
  enforceFederalTruth,
} from "../scripts/lib/federal-scheduling.mjs";

/**
 * Guards the fact-integrity layer added after the 2026-08-28 incident, where a
 * KATU article claiming the DEA had banned 7-OH was summarized into a federal
 * policy alert and pushed to 44 users. A reader caught it before we did.
 *
 * The two things that must never silently break:
 *   1. "Rule + effective date passed" is the ONLY thing that means SCHEDULED.
 *      A Proposed Rule is not a ban, no matter how the press writes it up.
 *   2. The substance matchers must not bleed into each other — every one of
 *      "7-hydroxymitragynine", "mitragynine pseudoindoxyl" and bare
 *      "mitragynine" contains the substring "mitragynine".
 *
 * Network is injected, so these run offline and deterministically.
 */

// Shaped like the real Federal Register API payloads for these documents.
const DOCS = [
  {
    document_number: "2026-17429",
    title: "Schedules of Controlled Substances: Temporary Placement of Mitragynine Pseudoindoxyl, MGM-15, and MGM-16 in Schedule I",
    type: "Rule",
    publication_date: "2026-08-26",
    effective_on: "2026-08-26",
    html_url: "https://example.test/17429",
  },
  {
    document_number: "2026-13580",
    title: "Schedules of Controlled Substance: Temporary Placement of 7-Hydroxymitragynine Above a Specified Threshold in Schedule I",
    type: "Proposed Rule",
    publication_date: "2026-07-06",
    effective_on: null,
    html_url: "https://example.test/13580",
  },
];

function fakeFetch(docs = DOCS) {
  return async () => ({ ok: true, json: async () => ({ results: docs }) });
}

const NOW = new Date("2026-08-28T00:00:00Z");
const bySubstance = (facts: any, key: string) =>
  facts.substances.find((s: any) => s.key === key);

describe("getFederalSchedulingFacts", () => {
  it("treats an effective Rule as scheduled and a Proposed Rule as merely proposed", async () => {
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
    expect(facts.ok).toBe(true);

    // The heart of the incident: 7-OH had only ever been PROPOSED.
    expect(bySubstance(facts, "7-oh").status).toBe("proposed");
    // The three compounds that actually were scheduled.
    for (const key of ["mitragynine-pseudoindoxyl", "mgm-15", "mgm-16"]) {
      expect(bySubstance(facts, key).status).toBe("scheduled");
      expect(bySubstance(facts, key).effectiveOn).toBe("2026-08-26");
    }
  });

  it("does not let 7-hydroxymitragynine or pseudoindoxyl leak into bare mitragynine", async () => {
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
    // Both document titles contain the substring "mitragynine", but neither
    // schedules the bare alkaloid. Getting this wrong is what produced the
    // "DEA placed mitragynine under emergency Schedule I" alert.
    expect(bySubstance(facts, "mitragynine").status).toBe("none");
    expect(bySubstance(facts, "kratom").status).toBe("none");
  });

  it("does not count a Rule whose effective date has not arrived yet", async () => {
    const future = [{ ...DOCS[0], effective_on: "2026-12-01" }];
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch(future) as any, now: NOW });
    expect(bySubstance(facts, "mgm-15").status).toBe("proposed");
  });

  it("ignores documents that are not scheduling actions", async () => {
    const noise = [{
      document_number: "2026-00001",
      title: "Agency Information Collection Activities; Kratom Consumer Survey",
      type: "Rule",
      publication_date: "2026-05-01",
      effective_on: "2026-05-01",
      html_url: "https://example.test/noise",
    }];
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch(noise) as any, now: NOW });
    expect(bySubstance(facts, "kratom").status).toBe("none");
  });

  it("degrades to ok:false instead of throwing when the API is unreachable", async () => {
    const boom = async () => { throw new Error("ECONNRESET"); };
    const facts = await getFederalSchedulingFacts({ fetchImpl: boom as any, now: NOW });
    expect(facts.ok).toBe(false);
    // An unreachable API must never be read as "nothing is scheduled".
    expect(facts.substances).toEqual([]);
    expect(groundingBlock(facts)).toBe("");
  });
});

describe("findFalseClaims", () => {
  let facts: any;
  beforeAll(async () => {
    facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
  });

  const claims = (t: string) => findFalseClaims(t, facts);

  it("catches the claims that actually shipped", () => {
    // The KATU summary that a reader had to email us about.
    expect(claims("On August 25, 2026, the DEA banned the sale and possession of 7-hydroxymitragynine (7-OH), a Schedule I controlled substance derived from kratom, for a two-year period.")).not.toHaveLength(0);
    // The alert the classifier embellished into existence.
    expect(claims("The DEA has placed the kratom alkaloid mitragynine under emergency Schedule I control, classifying it alongside 7-hydroxymitragynine (7-OH).")).not.toHaveLength(0);
    expect(claims("The FDA has classified 7-OH as a Schedule I controlled substance, a category that includes drugs like heroin and LSD.")).not.toHaveLength(0);
  });

  // Every case below is a real sentence from the corpus that an earlier, looser
  // version of this guard flagged. 15 of the first 32 hits were noise, and a
  // fact-checker that cries wolf is one nobody reads.
  it("does not flag an agency ARGUING for a schedule", () => {
    expect(claims("The FDA argues that 7-OH poses serious health risks and should be classified as a Schedule I controlled substance.")).toHaveLength(0);
    expect(claims("The Drug Enforcement Administration is reviewing whether 7-OH should be classified as a Schedule I controlled substance.")).toHaveLength(0);
  });

  it("does not flag accurate reporting about the 7-OH-RELATED compounds that were scheduled", () => {
    expect(claims("The DEA has also temporarily scheduled three 7-OH-related substances, MP, MGM-15, and MGM-16, often found in products marketed as kratom extracts.")).toHaveLength(0);
  });

  it("does not flag state-level bans, which are real", () => {
    expect(claims("Officials are targeting 7-hydroxymitragynine, or 7-OH, which has been banned or restricted in at least five states.")).toHaveLength(0);
    expect(claims("North Dakota placed 7-OH in Schedule I under an emergency executive order by the governor.")).toHaveLength(0);
  });

  it("does not flag a comparison to a DIFFERENT substance's scheduling", () => {
    expect(claims("The DEA recently classified the synthetic opioid O-DSMT as a Schedule I controlled substance in 49 days, raising concerns about a similar rapid scheduling of 7-OH.")).toHaveLength(0);
  });

  it("does not flag non-scheduling uses of 'classified'", () => {
    expect(claims("The FDA has classified 7-OH as an opioid due to its chemical properties.")).toHaveLength(0);
    expect(claims("The FDA has previously classified 7-OH products as dangerous and potentially addictive.")).toHaveLength(0);
  });

  it("does not flag accurate negative reporting", () => {
    expect(claims("Although traditional kratom is not banned under federal law, the FDA has warned consumers about health risks.")).toHaveLength(0);
    expect(claims("7-OH remains unscheduled federally while the comment period stays open.")).toHaveLength(0);
  });

  it("never re-flags our own correction copy", () => {
    const corrected = enforceFederalTruth("The DEA banned 7-OH and placed it in Schedule I.", facts);
    expect(corrected.corrected).toBe(true);
    expect(findFalseClaims(corrected.text, facts)).toHaveLength(0);
  });
});

describe("enforceFederalTruth", () => {
  it("leads with the verified record and keeps the original text", async () => {
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
    const original = "The DEA banned 7-OH and placed it in Schedule I for two years.";
    const out = enforceFederalTruth(original, facts, { dateStr: "2026-08-28" });
    expect(out.text.startsWith("CORRECTION (2026-08-28)")).toBe(true);
    expect(out.text).toContain("remains a proposal only");
    expect(out.text).toContain(original);
  });

  it("leaves clean text untouched", async () => {
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
    const clean = "Massachusetts issued an emergency order restricting kratom sales.";
    const out = enforceFederalTruth(clean, facts);
    expect(out.corrected).toBe(false);
    expect(out.text).toBe(clean);
  });
});

describe("groundingBlock", () => {
  it("states scheduled vs not-scheduled unambiguously and cites the documents", async () => {
    const facts = await getFederalSchedulingFacts({ fetchImpl: fakeFetch() as any, now: NOW });
    const block = groundingBlock(facts);
    expect(block).toMatch(/7-hydroxymitragynine \(7-OH\): NOT federally scheduled/);
    expect(block).toMatch(/mitragynine pseudoindoxyl: IS in Schedule I federally/);
    expect(block).toContain("2026-17429");
    expect(block).toContain("2026-13580");
    // Must tell the model to NAME a contradiction rather than quietly rewrite
    // the publisher's claim into agreement with us.
    expect(block).toMatch(/Do not silently\s+correct/);
  });
});
