import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { portraitSparql, pickPortrait, commonsFile } from "../scripts/lib/wikidata-portrait.mjs";

/**
 * 2026-11-18: a name-only Wikidata match put famous namesakes on local seats
 * (Speaker Kevin McCarthy for a Normal, IL council member). The photo query
 * must tie the person to an office in the same state.
 */
describe("wikidata portrait query", () => {
  it("requires an office inside the official's state", () => {
    const q = portraitSparql("Kevin McCarthy", "IL")!;
    expect(q).toContain('wdt:P300 "US-IL"');
    expect(q).toMatch(/wdt:P1001\/wdt:P131\* \?state/);
    expect(q).toMatch(/pq:P768\/wdt:P131\* \?state/);
    expect(q).not.toMatch(/wdt:P27 wd:Q30/); // the old "any American" test
  });
  it("refuses names too short to match safely, or no state", () => {
    expect(portraitSparql("Al", "TX")).toBeNull();
    expect(portraitSparql("Greg Smith", null)).toBeNull();
    expect(portraitSparql('Bob "x" Jones', "OK")).toContain('"Bob  x  Jones"@en');
  });
  it("takes one distinct image only", () => {
    const b = (v: string) => ({ img: { value: v } });
    expect(pickPortrait([b("a"), b("a")])).toBe("a");
    expect(pickPortrait([b("a"), b("b")])).toBeNull();
    expect(pickPortrait([])).toBeNull();
  });
  it("compares Commons links by file", () => {
    expect(commonsFile("http://commons.wikimedia.org/wiki/Special:FilePath/Rep%20Greg%20Smith.jpg")).toBe("rep greg smith.jpg");
    expect(commonsFile("https://commons.wikimedia.org/wiki/Special:FilePath/Rep_Greg_Smith.jpg")).toBe("rep greg smith.jpg");
    expect(commonsFile("https://r2.example/portraits/x.jpg")).toBeNull();
  });
  it("the portrait sync uses the state-checked query", () => {
    const src = readFileSync("scripts/sync-official-portraits.mjs", "utf8");
    expect(src).toMatch(/stateCheckedPortrait\(fullName, stateAbbr\)/);
    expect(src).not.toMatch(/wdt:P27 wd:Q30/);
  });
});
