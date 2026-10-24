import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { billAxes, buildRecords, recordByAxis, recordFact, statusWord, voteLabel, type RecordBill } from "../src/lib/kratom-record";

/**
 * "Your legislators' kratom record" (B11, 2026-10-21): records, not
 * endorsements. These pin that duplicate bill rows merge, votes read plainly,
 * and that no pro/anti label ever reaches a named person.
 */
const bill = (over: Partial<RecordBill>): RecordBill => ({
  id: "b1", state: "OK", bill_number: "SB 891", title: "Kratom products; modifying certain definitions", status: "enacted", session_id: "s1", ...over,
});

describe("buildRecords", () => {
  it("merges the same bill stored as several rows (session re-use)", () => {
    const rec = buildRecords(
      [
        { legislator_id: "L1", vote_text: "Yea", vote_value: "1", vote_date: "2025-04-01", motion: "Third reading", bill: bill({ id: "b1", session_id: "s1" }) },
        { legislator_id: "L1", vote_text: "Yea", vote_value: "1", vote_date: "2025-04-01", motion: "Third reading", bill: bill({ id: "b2", session_id: "s2" }) },
      ],
      [{ legislator_id: "L1", classification: "primary", bill: bill({ id: "b3", session_id: "s3" }) }],
    );
    const list = rec.get("L1")!;
    expect(list).toHaveLength(1);
    expect(list[0].sponsored).toBe("primary");
    expect(list[0].votes).toEqual([{ vote: "Yes", date: "2025-04-01", motion: "Third reading" }]);
  });

  it("keeps a re-used bill number with a different title separate", () => {
    const rec = buildRecords([], [
      { legislator_id: "L1", classification: "primary", bill: bill({ title: "Kratom Consumer Protection Act" }) },
      { legislator_id: "L1", classification: "cosponsor", bill: bill({ title: "Highway funding" }) },
    ]);
    expect(rec.get("L1")).toHaveLength(2);
  });

  it("reads votes plainly", () => {
    expect(voteLabel("Yea", "1")).toBe("Yes");
    expect(voteLabel("Nay", "2")).toBe("No");
    expect(voteLabel("NV", "3")).toBe("Did not vote");
    expect(voteLabel("Absent", "4")).toBe("Did not vote");
    expect(statusWord("enacted")).toBe("became law");
    expect(statusWord("passed_chamber")).toBe("passed one chamber");
  });
});

describe("records, not endorsements", () => {
  const page = readFileSync(new URL("../src/app/record/[state]/page.tsx", import.meta.url), "utf8");
  const lib = readFileSync(new URL("../src/lib/kratom-record.ts", import.meta.url), "utf8");

  it("never renders a pro/anti label on a bill or a person", () => {
    // kratom_relevance only SELECTS which bills count; it is never displayed.
    expect(page).not.toMatch(/\{[^}]*kratom_relevance[^}]*\}/);
    expect(page).not.toMatch(/\b(pro-kratom|anti-kratom|ally|allies|opponents?)\b/i);
    expect(lib).not.toMatch(/kratom_relevance:/);
  });

  it("reads public data through the anonymous client and caches it", () => {
    expect(page).toMatch(/createAnonClient\(\)/);
    expect(page).toMatch(/publicSnapshot\("kratom-record"/);
    expect(page).toMatch(/export function generateStaticParams/);
  });
});

describe("the campaign recipient chips (Paul, 2026-10-24: \"stance MIA\")", () => {
  const leaf = { stance: "schedules", confidence: 1 };
  const oh = { stance: "restricts", confidence: "0.9" };

  it("files a bill under the axes its text confidently addresses", () => {
    expect(billAxes(bill({ leaf, seven_oh: oh }))).toEqual(["natural_leaf", "seven_oh"]);
    expect(billAxes(bill({ leaf: { stance: "unaddressed", confidence: 1 }, seven_oh: oh }))).toEqual(["seven_oh"]);
    expect(billAxes(bill({ leaf: { stance: "bans", confidence: 0.5 } }))).toEqual([]);
    expect(billAxes(bill({}))).toEqual([]); // /record loads no substance map
  });

  it("states what the person did, never a verdict", () => {
    const [e] = buildRecords(
      [
        { legislator_id: "L1", vote_text: "Yea", vote_value: "1", vote_date: "2025-05-05", motion: "Third reading", bill: bill({ leaf, seven_oh: oh }) },
        { legislator_id: "L1", vote_text: "Nay", vote_value: "2", vote_date: "2025-03-01", motion: "Committee", bill: bill({ leaf, seven_oh: oh }) },
      ],
      [{ legislator_id: "L1", classification: "primary", bill: bill({ leaf, seven_oh: oh }) }],
    ).get("L1")!;
    expect(recordFact(e)).toBe("Primary sponsor · Voted Yes (Third reading, 2025-05-05) (+1 more vote)");
    const byAxis = recordByAxis([e]);
    expect(byAxis.natural_leaf).toHaveLength(1);
    expect(byAxis.seven_oh).toHaveLength(1);
    expect(byAxis.other).toHaveLength(0);
  });

  it("no longer read the champion/hostile labels, and say so when nothing is recorded", () => {
    const chips = readFileSync(new URL("../src/modules/campaigns/components/RecipientChips.tsx", import.meta.url), "utf8");
    const pageSrc = readFileSync(new URL("../src/app/campaigns/[slug]/page.tsx", import.meta.url), "utf8");
    const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""); // comments may name what was removed
    expect(code(chips)).not.toMatch(/\b(champion|sympathetic|hostile|ally|allies|opponents?)\b|title=\{`Stance/i);
    expect(code(pageSrc)).not.toMatch(/from\("legislator_stance"\)/);
    expect(chips).toContain("No recorded position yet");
    expect(chips).toContain("Tap a name for details");
    expect(chips).toMatch(/aria-expanded=\{open\}/);
    expect(chips).toContain("/briefing");
  });
});
