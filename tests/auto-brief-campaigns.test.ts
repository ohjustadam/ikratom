import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * 2026-11-18: the nightly auto-brief failed outright on 7 of 12 nights because
 * federal campaigns (no state) took every slot, and research-campaign.mjs
 * refuses them. Its stderr was dropped, so the log only said "exit 1".
 */
describe("auto-brief-campaigns picks only campaigns it can brief", () => {
  const src = readFileSync("scripts/auto-brief-campaigns.mjs", "utf8");
  const research = readFileSync("scripts/research-campaign.mjs", "utf8");
  it("skips no-state campaigns while research-campaign still refuses them", () => {
    if (/federal campaigns aren't supported/.test(research)) {
      expect(src).toMatch(/\.not\("state", "is", null\)/);
    }
  });
  it("shows the child's stderr when a brief fails", () => {
    expect(src).toMatch(/\$\{r\.stderr \?\? ""\}/);
  });
});
