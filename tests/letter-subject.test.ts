import { describe, it, expect } from "vitest";
import { memberSubject } from "../src/lib/letter-subject";

const LONG = "Constituent input on kratom policy in South Carolina";
const seeds = Array.from({ length: 100 }, (_, i) => `member-${i}:campaign-1`);

describe("a member's subject line", () => {
  it("varies across 100 members of one campaign", () => {
    const seen = new Set(seeds.map((seed) => memberSubject({ template: LONG, seed })));
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it("stays the same for one member on one campaign", () => {
    const pick = () => memberSubject({ template: LONG, billNumber: "SB 860", seed: "m:c" });
    expect(pick()).toBe(pick());
  });

  it("is short, takes no side, and claims no residency", () => {
    for (const seed of seeds) {
      for (const billNumber of [null, "SB 860"]) {
        const subject = memberSubject({ template: LONG, billNumber, seed });
        expect(subject.length).toBeLessThanOrEqual(40);
        expect(subject).not.toMatch(/constituent|oppose|support|^re:/i);
      }
    }
  });

  it("names the bill when there is one", () => {
    const subjects = seeds.map((seed) => memberSubject({ template: LONG, billNumber: "HB 1784", seed }));
    expect(subjects.every((s) => s.includes("HB 1784"))).toBe(true);
  });

  it("ignores an id that isn't a bill number", () => {
    const subjects = seeds.map((seed) =>
      memberSubject({ template: LONG, billNumber: "San-Buenaventura-Ord-2026", seed }),
    );
    expect(subjects.some((s) => s.includes("Buenaventura"))).toBe(false);
  });

  it("keeps a campaign's own subject in the rotation only when it's short", () => {
    const own = "Kratom policy in Iowa";
    expect(seeds.map((seed) => memberSubject({ template: own, seed }))).toContain(own);
    expect(seeds.map((seed) => memberSubject({ template: LONG, seed }))).not.toContain(LONG);
  });
});
