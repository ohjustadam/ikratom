import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { STANCE_LABELS_RETIRED, publishedStance } from "../src/lib/published-stance";
import { assessThreat, effectiveStance, type ThreatInputs } from "../src/lib/legislator-threat-score";

/**
 * Champion / sympathetic / hostile labels on named officials are retired
 * (trunk call 2026-10-25, the owner's standing decision from #813). The
 * table and its data stay; no member-facing surface renders them.
 */

const base: ThreatInputs = {
  stance: "unknown",
  has_anti_sponsorship: false, has_pro_sponsorship: false, primary_sponsorship_count: 0, cosponsorship_count: 0,
  is_chair_of_kratom_relevant: false, is_member_of_kratom_relevant: false, bills_in_their_committees: 0,
  pharma_usd: null, alcohol_usd: null, tobacco_usd: null, addiction_treatment_usd: null, cannabis_usd: null,
  gaming_usd: null, hospital_health_usd: null, kratom_adjacent_trade_count: null,
};

describe("the switch", () => {
  it("is on, and every stored label reads as unknown", () => {
    expect(STANCE_LABELS_RETIRED).toBe(true);
    for (const s of ["champion", "sympathetic", "neutral", "hostile", "unknown", null, undefined]) {
      expect(publishedStance(s)).toBe("unknown");
    }
  });

  it("no hostile or champion is derived from sponsoring a bill", () => {
    const antiSponsor = { ...base, has_anti_sponsorship: true, primary_sponsorship_count: 1, is_chair_of_kratom_relevant: true };
    const proSponsor = { ...base, has_pro_sponsorship: true, primary_sponsorship_count: 1 };
    expect(effectiveStance(antiSponsor).stance).toBe("unknown");
    expect(effectiveStance(proSponsor).stance).toBe("unknown");
    for (const inp of [antiSponsor, proSponsor, { ...base, has_anti_sponsorship: true }, { ...base, has_pro_sponsorship: true }]) {
      expect(["active_opponent", "hostile_decision_maker", "champion", "sympathetic_ally"]).not.toContain(assessThreat(inp).tier);
    }
  });
});

describe("every member-facing reader goes through the switch", () => {
  const SRC = path.resolve(__dirname, "../src");
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = path.join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, "/");
  // Admin review is where a human looks at the drafts; the two others only count rows.
  const EXEMPT = [/^app\/admin\//, /^modules\/admin\//, /^app\/intel\/page\.tsx$/, /^app\/status\/page\.tsx$/];
  const readers = walk(SRC).filter((p) => /from\("legislator_stance"\)/.test(readFileSync(p, "utf8")));
  const gated = readers.filter((p) => !EXEMPT.some((re) => re.test(rel(p))));

  it("finds the readers (the scan is not vacuous)", () => {
    expect(gated.length).toBeGreaterThanOrEqual(9);
  });

  it.each(gated.map((p) => [rel(p), p]))("%s", (_name, p) => {
    expect(readFileSync(p as string, "utf8")).toMatch(/publishedStance\(|STANCE_LABELS_RETIRED/);
  });

  it("the operation page has no stance chip, and briefings get no labels", () => {
    const op = readFileSync(path.join(SRC, "app/campaigns/operation/[slug]/OperationResponseClient.tsx"), "utf8");
    expect(op).not.toMatch(/STANCE_EMOJI|STANCE_TONE/);
    const gen = readFileSync(path.resolve(__dirname, "../scripts/generate-state-briefing.mjs"), "utf8");
    expect(gen).not.toMatch(/from\("legislator_stance"\)/);
    expect(gen).not.toMatch(/Quote admin stance rationales/);
  });
});
