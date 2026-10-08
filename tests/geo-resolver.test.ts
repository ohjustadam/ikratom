import { describe, it, expect } from "vitest";
import { resolveLocality } from "../scripts/lib/geo-resolver.mjs";

// Each case: [title, candidateState (the wrong/guessed value), expectedLocality]
// candidateState simulates the AI/scrape-bucket guess we must NOT blindly trust.
const cases = [
  // ── The reported production bugs ──
  ["Kratom, 7-OH ban takes effect July 1; Reno County highlights support resources", "NV", "KS"], // Reno County = Kansas
  ["Reno County commission discusses kratom ordinance", "AZ", "KS"],
  ["Normal Town Council to vote on kratom ban, following Bloomington", "RI", "IL"], // Normal+Bloomington = Illinois
  ["Normal Town Council kratom vote; meeting in Normal, IL", "VA", "IL"], // "City, ST" pins IL
  ["FDA recommends classifying kratom byproduct as controlled substance", "AK", "FED"], // national, not Alaska
  ["FDA asks Justice Department to ban kratom nationwide", "FED", "FED"],
  ["Sterling Heights council weighs kratom restrictions", "CO", "MI"], // Sterling Heights = Michigan

  // ── Should be LEFT ALONE (correct already / no false override) ──
  ["Gov. Beshear moves to block access to a form of kratom", "KY", "KY"], // person, no place/fed signal -> keep
  ["Committee meets to discuss the impact of the drug kratom in West Virginia", "WV", "WV"], // explicit state name
  ["Missouri's largest Kratom distributor agrees to stop sales", "MO", "MO"], // explicit state name
  ["Idaho Falls City Council Has Banned the Sale of Kratom Within the City", "ID", "ID"],
  ["Brandon Clarke said it's just kratom. His death has the substance under scrutiny.", "AR", "AR"], // names must NOT override
  ["Tennessee kratom ban takes effect July 1 - KOLN Nebraska Lincoln NE", "TN", "TN"], // own-state named -> source byline "Lincoln, NE" must NOT override
  ["Federal court rejects attempt to block new kratom regulation law", "UT", "UT"], // "federal court" is not a federal action; keep candidate

  // ── State "Schedule I" bills are STATE actions, not federal ──
  ["Gov. Kelly signs bill classifying 7-OH kratom as Schedule I drug", "KS", "KS"], // KS state bill, not FED
  ["Kratom could be classified as Schedule I controlled substance under new PA bill", "PA", "PA"], // PA bill, not FED
  // ── A city named after a state must not be read as the state ──
  ["Washington bans sale of synthetic kratom, allows lab-tested versions", "IL", "IL"], // Washington, IL (not WA)

  // ── False-positive guards: a single-word name must NOT override a valid state ──
  ["Suffolk lawmakers reschedule vote to potentially ban kratom", "NY", "NY"], // Suffolk (VA city) must not override NY
  ["Rep. Brennan issues statement on JCARR review of synthetic kratom", "OH", "OH"], // surname must not override
  ["Rome City Commission expresses support for kratom bill", "GA", "GA"], // "Rome City" (org words) must not match Rome City, IN

  // ── County mislabeled to a state it isn't in ──
  ["Nassau County board reviews kratom sales rules", "CT", "NY"], // Nassau County resolves to NY (never CT)
  ["Lawrence County considers kratom restrictions", "TX", "ALL"], // Lawrence County in 11 states, none TX -> safe ALL

  // ── "Place, ST" pairs (as seen in specific_locality) ──
  ["Grant County, WA health board acts on kratom", "DC", "WA"], // county-in-state pair pins WA
  ["San Luis Obispo County, CA debates kratom", "CA", "CA"],

  // ── A state story that also name-drops a federal agency stays the state ──
  ["West Virginia lawmakers respond to FDA kratom recommendation", "FED", "WV"],
];

describe("geo-resolver: deterministic locality resolution", () => {
  for (const [title, candidate, expected] of cases) {
    it(`"${title.slice(0, 48)}..." (${candidate}) -> ${expected}`, () => {
      const r = resolveLocality({ title, text: title, candidateState: candidate });
      expect(r.locality, `reason: ${r.reason}`).toBe(expected);
    });
  }

  it("never invents a state when there is no evidence and no candidate", () => {
    expect(resolveLocality({ title: "Kratom news roundup", text: "", candidateState: null }).locality).toBe("ALL");
  });

  it("a corrected result is marked not-corroborated", () => {
    const r = resolveLocality({ title: "Reno County kratom ban", text: "", candidateState: "NV" });
    expect(r.locality).toBe("KS");
    expect(r.corroborated).toBe(false);
  });
});
