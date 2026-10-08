import { describe, it, expect } from "vitest";
import { normalizeForTTS } from "../scripts/lib/tts-normalize.mjs";

describe("normalizeForTTS: human-sounding policy speech", () => {
  it("reads Roman-numeral drug schedules as numbers, not letters", () => {
    expect(normalizeForTTS("classified as Schedule I drug")).toContain("Schedule one");
    expect(normalizeForTTS("moved to Schedule II")).toContain("Schedule two");
    expect(normalizeForTTS("Schedule III substance")).toContain("Schedule three");
    expect(normalizeForTTS("Schedule IV")).toContain("Schedule four");
    expect(normalizeForTTS("FDA Marks 7-OH for CSA Schedule I")).toContain("Schedule one");
  });

  it("expands RFK Jr. and honorifics", () => {
    expect(normalizeForTTS("RFK Jr. announces")).toContain("Robert F. Kennedy Junior");
    expect(normalizeForTTS("Gov. Beshear moves to block kratom")).toMatch(/^Governor Beshear/);
    expect(normalizeForTTS("Sen. Smith and Rep. Jones")).toBe("Senator Smith and Representative Jones");
  });

  it("expands or spells agencies sensibly", () => {
    const out = normalizeForTTS("FDA asks DOJ; the CSA and DEA");
    expect(out).toContain("F D A");
    expect(out).toContain("Department of Justice");
    expect(out).toContain("Controlled Substances Act");
    expect(out).toContain("D E A");
  });

  it("handles chemistry + places + symbols", () => {
    expect(normalizeForTTS("7-OH ban")).toContain("seven-hydroxy");
    expect(normalizeForTTS("St. Louis council")).toContain("Saint Louis");
    expect(normalizeForTTS("Mt. Prospect")).toContain("Mount Prospect");
    expect(normalizeForTTS("health & safety")).toContain("health and safety");
  });

  it("does not mangle ordinary text", () => {
    expect(normalizeForTTS("The council voted to ban kratom sales.")).toBe("The council voted to ban kratom sales.");
  });
});
