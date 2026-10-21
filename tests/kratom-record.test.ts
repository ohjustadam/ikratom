import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildRecords, statusWord, voteLabel, type RecordBill } from "../src/lib/kratom-record";

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
