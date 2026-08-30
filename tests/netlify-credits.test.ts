/**
 * Tests for the Netlify credit estimator + threshold ladder.
 *
 * These numbers are the actual 2026-07-30 outage. www.ikratom.org was disabled
 * with `disabled_reason: "Account usage exceeded for credits"` while the
 * watchdog reported healthy, because it measured bandwidth (0.77GB against a
 * 100GB ceiling = 0.8%) instead of the credit pool that actually decides
 * whether the site serves traffic.
 *
 * The real burn was 15 production deploys x 15 credits = 225, plus 0.771GB of
 * bandwidth x 20 = ~15, i.e. >=240 of the 300-credit budget. Lock that in: if
 * anyone "simplifies" the rates or the ladder, these fail.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RATES,
  CREDIT_THRESHOLDS,
  creditSeverity,
  estimateNetlifyCredits,
} from "../scripts/lib/netlify-credits.mjs";

describe("published credit rates", () => {
  it("matches Netlify's rate card", () => {
    // A production deploy costing 15 credits is the whole reason deploy
    // discipline matters — 20 deploys alone exceeds the entire free budget.
    expect(RATES.perProductionDeploy).toBe(15);
    expect(RATES.perGbBandwidth).toBe(20);
    expect(RATES.per10kRequests).toBe(2);
    expect(RATES.perGbHourCompute).toBe(10);
  });

  it("free budget is exhausted by 20 deploys and nothing else", () => {
    expect(20 * RATES.perProductionDeploy).toBe(300);
  });
});

describe("creditSeverity ladder", () => {
  const cases: Array<[number, string]> = [
    [0, "ok"],
    [49.9, "ok"],
    [50, "notice"],
    [64.9, "notice"],
    [65, "warn"],
    // Ladder re-cut 2026-08-30 and now applied to the PROJECTED total, not the
    // measurable floor. Netlify's own alert fires at 75%, so 75 must already be
    // "critical" — under the old ladder it read "warn" while the account was
    // three-quarters spent.
    [75, "critical"],
    [79.9, "critical"],
    [80, "critical"],
    [84.9, "critical"],
    [85, "brake"],
    [89.9, "brake"],
    [90, "brake"],
    [140, "brake"],
  ];
  for (const [pct, expected] of cases) {
    it(`${pct}% -> ${expected}`, () => {
      expect(creditSeverity(pct), `pct=${pct}`).toBe(expected);
    });
  }

  it("thresholds stay ordered and below 100", () => {
    const { notice, warn, critical, brake } = CREDIT_THRESHOLDS;
    expect(notice).toBeLessThan(warn);
    expect(warn).toBeLessThan(critical);
    expect(critical).toBeLessThan(brake);
    // The projection can still under-read, so a brake at or above 100 would
    // only ever fire after the site was already dark. It must trip early.
    expect(brake).toBeLessThan(100);
  });
});

describe("estimateNetlifyCredits", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Reproduce the account exactly as it looked when the site went down. */
  function stubOutageAccount() {
    const deploys = [
      // 15 shipped production deploys ...
      ...Array.from({ length: 15 }, (_, i) => ({
        created_at: `2026-07-2${i % 9}T10:00:00.000Z`,
        context: "production",
        state: "ready",
      })),
      // ... plus failures and previews, which must NOT be charged at 15 each.
      ...Array.from({ length: 14 }, () => ({
        created_at: "2026-07-25T10:00:00.000Z",
        context: "production",
        state: "error",
      })),
      { created_at: "2026-07-25T10:00:00.000Z", context: "deploy-preview", state: "ready" },
      // Predates the usage period — must be ignored entirely.
      { created_at: "2026-07-01T10:00:00.000Z", context: "production", state: "ready" },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = url.includes("/bandwidth")
        ? { used: 770732452 }
        : url.includes("/deploys")
          ? deploys
          : {
              plan_credits: 300,
              current_usage_period_start: "2026-07-19T00:00:00.000-07:00",
              next_usage_period_start: "2026-08-19T00:00:00.000-07:00",
              usages_exceeded: [
                { usage_type: "credits", limit_type: "enforced", exceeded_at: "2026-07-30T13:02:25.909Z" },
              ],
              grace_topup_granted_at: "2026-07-29T04:39:49.390Z",
            };
      return { ok: true, json: async () => body };
    }));
  }

  it("reproduces the outage: >=240 of 300 credits, 80.1%", async () => {
    stubOutageAccount();
    const est = await estimateNetlifyCredits({ token: "t", accountSlug: "a", siteId: "s" });

    expect(est.deploys, "only ready+production deploys inside the period count").toBe(15);
    expect(est.deployCredits).toBe(225);
    expect(est.bandwidthCredits).toBeCloseTo(15.41, 1);
    expect(est.usedFloor).toBeCloseTo(240.41, 1);
    // `pct` is now the PROJECTED burn (floor / MEASURED_FLOOR_SHARE), which is
    // what the brake acts on. The floor's own percentage is kept as floorPct.
    expect(est.floorPct).toBeCloseTo(80.1, 1);
    expect(est.projectedUsed).toBeCloseTo(240.41 / 0.43, 0);
    expect(est.pct).toBeGreaterThan(est.floorPct);
    expect(est.blindCredits).toBeGreaterThan(0);
    // On the day of the 2026-07-30 outage the projection reads BRAKE, not
    // merely "critical". That is the whole point of the re-cut: the old
    // floor-based ladder called an account that was about to be disabled
    // "critical" and kept letting deploys through.
    expect(creditSeverity(est.pct)).toBe("brake");
    expect(est.exceeded, "Netlify's own flag must be surfaced").toBe(true);
    expect(est.graceTopupAt).toBeTruthy();
    // Requests + compute are unreadable on free, so this must never be
    // presented as a total. Consumers render it as ">=".
    expect(est.isFloor).toBe(true);
  });

  it("reports not-ok without a token rather than a silent zero", async () => {
    // A missing token returning 0% would be a green light into an outage —
    // exactly the failure mode being fixed here.
    const est = await estimateNetlifyCredits({ token: "", accountSlug: "a", siteId: "s" });
    expect(est.ok).toBe(false);
    expect(est.reason).toMatch(/NETLIFY_AUTH_TOKEN/);
  });

  it("degrades instead of throwing when the bandwidth endpoint fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("/bandwidth")) return { ok: false, status: 500, json: async () => ({}) };
      if (url.includes("/deploys")) return { ok: true, json: async () => [] };
      return {
        ok: true,
        json: async () => ({
          plan_credits: 300,
          current_usage_period_start: "2026-07-19T00:00:00.000-07:00",
          next_usage_period_start: "2026-08-19T00:00:00.000-07:00",
          usages_exceeded: [],
        }),
      };
    }));
    const est = await estimateNetlifyCredits({ token: "t", accountSlug: "a", siteId: "s" });
    expect(est.ok, "losing one input must not blind the whole check").toBe(true);
    expect(est.bandwidthGb).toBe(0);
  });
});
