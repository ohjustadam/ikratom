import { describe, it, expect } from "vitest";
import { getFederalSchedulingFacts, groundingBlock } from "../scripts/lib/federal-scheduling.mjs";

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
