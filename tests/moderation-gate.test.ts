import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isRelevantSnippet, relevantSnippets, articleExcerpt, hasActionableEvidence, canAutoReject, canAutoApprove,
  CAMPAIGN_PROMPT, INTEL_PROMPT, promptFor,
} from "../scripts/lib/moderation-gate.mjs";
import { autoDecision } from "../src/modules/admin/queue-resolve-policy";
import type { PlanItem } from "../src/modules/admin/queue-resolve-types";

/**
 * Pins the 2026-10-21 fix. The automated reviewers had rejected real campaigns
 * and real news because a web search returned junk, and "couldn't find it" was
 * read as "it doesn't exist". Every case below is a real item from that audit.
 */
const LEE_JEANS = [
  { title: "Lee Jeans | Men's & Women's Denim", content: "Shop Lee jeans, jackets and more." },
  { title: "Lee (brand) - Wikipedia", content: "Lee is an American brand of denim jeans." },
];
const TV_SEE = [
  { title: "See (TV series) - Wikipedia", content: "See is an American science fiction drama television series." },
  { title: "SEE Definition & Meaning", content: "to perceive by the eye" },
];
const REAL = [
  { title: "Lee County's kratom ban goes into effect", content: "The Lee County Board of Supervisors' kratom ban takes effect Friday." },
  { title: "MS health officer wants kratom regulated", content: "Dr. Daniel Edney will push for 7-OH and kratom rules in 2027." },
];
const CLARION = "Mississippi's State Health Officer is pushing for strict regulation of kratom during the 2027 legislative session after the deaths of two Ole Miss students.";

describe("evidence", () => {
  it("throws away search results that are not about kratom", () => {
    expect(LEE_JEANS.some(isRelevantSnippet)).toBe(false);
    expect(TV_SEE.some(isRelevantSnippet)).toBe(false);
    expect(relevantSnippets([...LEE_JEANS, ...REAL])).toHaveLength(2);
    expect(isRelevantSnippet({ title: "DEA moves on 7-OH", content: "" })).toBe(true);
    expect(isRelevantSnippet({ title: "mitragynine study", content: "" })).toBe(true);
  });

  it("an article only counts if it mentions kratom", () => {
    expect(articleExcerpt("Weather: sunny. Sports: the game.")).toBe("");
    expect(articleExcerpt(`Menu Home Sports ${CLARION}`)).toContain("regulation of kratom");
  });

  it("the audit's failed searches can never justify a reject", () => {
    const highReject = { verdict: "reject", confidence: "high" };
    expect(canAutoReject(highReject, { sourceText: "", snippets: relevantSnippets(LEE_JEANS) })).toBe(false);
    expect(canAutoReject(highReject, { sourceText: "", snippets: relevantSnippets(TV_SEE) })).toBe(false);
  });

  it("a reject needs HIGH confidence and real evidence", () => {
    const withSource = { sourceText: CLARION, snippets: [] };
    expect(canAutoReject({ verdict: "reject", confidence: "high" }, withSource)).toBe(true);
    expect(canAutoReject({ verdict: "reject", confidence: "medium" }, withSource)).toBe(false);
    expect(canAutoReject({ verdict: "reject", confidence: "high" }, { sourceText: "", snippets: [REAL[0]] })).toBe(false);
    expect(canAutoReject({ verdict: "reject", confidence: "high" }, { sourceText: "", snippets: REAL })).toBe(true);
    expect(hasActionableEvidence({ sourceText: "", snippets: [] })).toBe(false);
  });

  it("an auto-approve needs the same evidence bar", () => {
    expect(canAutoApprove({ verdict: "approve", confidence: "high" }, { sourceText: CLARION, snippets: [] })).toBe(true);
    expect(canAutoApprove({ verdict: "approve", confidence: "high" }, { sourceText: "", snippets: [] })).toBe(false);
  });
});

describe("prompts", () => {
  const factcheck = readFileSync(new URL("../src/lib/moderation/factcheck.ts", import.meta.url), "utf8");

  it("no reviewer may reject for 'could not confirm' or 'does not appear to exist'", () => {
    for (const p of [CAMPAIGN_PROMPT, INTEL_PROMPT, factcheck]) {
      expect(p).not.toMatch(/does not appear to exist|hallucination\)/i);
      expect(p).toMatch(/NEVER reject because you could not confirm/);
    }
  });

  it("intel is news: an enacted ban is never a reason to reject it", () => {
    expect(INTEL_PROMPT).toMatch(/NEVER a reason to reject intel/);
    expect(factcheck).toMatch(/NEVER a reason to reject intel/);
    expect(promptFor("intel")).toBe(INTEL_PROMPT);
    expect(promptFor("campaign")).toBe(CAMPAIGN_PROMPT);
  });

  it("the in-site checker refuses an ungrounded verdict", () => {
    expect(factcheck).toMatch(/if \(provider !== "gemini"\)/);
  });

  it("the nightly script uses the shared gate, the item's source, and per-kind prompts", () => {
    const script = readFileSync(new URL("../scripts/clear-review-queues.mjs", import.meta.url), "utf8");
    expect(script).toMatch(/canAutoReject\(d, evidence\)/);
    expect(script).toMatch(/sourceUrlFor\(kind, row\)/);
    expect(script).toMatch(/promptFor\(kind\)/);
    expect(script).not.toMatch(/d\.confidence === "medium"\) && hits\.length > 0/);
  });
});

describe("one-click auto-resolve policy", () => {
  const item = (action: PlanItem["action"], confidence: PlanItem["confidence"], source: PlanItem["source"]): PlanItem =>
    ({ id: "x", title: "t", subtitle: "s", action, confidence, reason: "r", source });

  it.each([
    [item("supersede", "high", "duplicate"), "supersede"],
    [item("reject", "high", "duplicate"), "reject"],
    [item("reject", "high", "bill-status"), "reject"],
    [item("reject", "high", "ai"), "reject"],
    [item("reject", "medium", "ai"), "keep"],
    [item("reject", "low", "ai"), "keep"],
    [item("approve", "high", "ai"), "approve"],
    [item("approve", "medium", "ai"), "approve"],
    [item("approve", "low", "ai"), "keep"],
    [item("keep", "low", "ai"), "keep"],
    [item("keep", "low", "cap"), "keep"],
  ])("%o -> %s", (p, want) => {
    expect(autoDecision(p)).toBe(want);
  });

  it("uncertain items are no longer rejected (they were until 2026-10-21)", () => {
    const actions = readFileSync(new URL("../src/modules/admin/queue-resolve-actions.ts", import.meta.url), "utf8");
    expect(actions).toMatch(/import \{ autoDecision \} from "\.\/queue-resolve-policy"/);
    expect(actions).not.toMatch(/function autoDecision/);
  });
});
