/**
 * egress-calibration.test.ts — one calibration, read by every egress estimate.
 *
 * 2026-10-07: the gate (anchor 16, ratio 0.497) read 74.5% and the watchdog
 * (anchor 18, same ratio) read 66.5% while the Supabase dashboard read 55%.
 * The gate paused 32 daily jobs on a phantom number. Both now read
 * scripts/lib/egress-calibration.json, measured against the dashboard.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { BILLABLE_RATIO, EGRESS_CYCLE_ANCHOR_DAY, CALIBRATION, TIER_LIMITS } from "../scripts/lib/egress-budget.mjs";

describe("egress calibration", () => {
  it("is loaded from the shared file and plausible", () => {
    expect(BILLABLE_RATIO).toBe(CALIBRATION.ratio);
    expect(EGRESS_CYCLE_ANCHOR_DAY).toBe(CALIBRATION.cycleAnchorDay);
    expect(BILLABLE_RATIO).toBeGreaterThan(0.15);
    expect(BILLABLE_RATIO).toBeLessThan(0.9);
    expect(EGRESS_CYCLE_ANCHOR_DAY).toBeGreaterThanOrEqual(1);
    expect(EGRESS_CYCLE_ANCHOR_DAY).toBeLessThanOrEqual(28);
    expect(CALIBRATION.overReportMargin).toBeGreaterThanOrEqual(1);
  });

  it("the daily watchdog has no private copy of the ratio or anchor", () => {
    const src = fs.readFileSync("scripts/check-egress-usage.mjs", "utf8");
    expect(src).toMatch(/import \{ BILLABLE_RATIO, EGRESS_CYCLE_ANCHOR_DAY \} from "\.\/lib\/egress-budget\.mjs"/);
    expect(src).not.toMatch(/^const (BILLABLE_RATIO|EGRESS_CYCLE_ANCHOR_DAY)\s*=/m);
  });

  it("member-facing work only stops near the real wall", () => {
    expect(TIER_LIMITS.normal).toBeGreaterThanOrEqual(0.9);
    expect(TIER_LIMITS.bulk).toBeGreaterThanOrEqual(0.8);
  });
});
