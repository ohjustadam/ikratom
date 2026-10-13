/**
 * egress-gate-projection.test.ts — 2026-10-13.
 *
 * 1. The gate read only the OLDEST 200 readings of a cycle. At ~17 readings a
 *    day that froze the number by day 12, its age passed 48h and the gate
 *    failed open, so the brake was off for the end of every cycle (it read
 *    74.9% while the true figure was 82%). It must read every reading.
 * 2. Past a tier's line, shed only when the burn rate projects the cycle to end
 *    near the cap. Throttling work that cannot cause a breach is its own cost.
 */
import { describe, it, expect } from "vitest";
import { getEgressStatus, checkEgressBudget, BILLABLE_RATIO, cycleStart } from "../scripts/lib/egress-budget.mjs";

type Row = { finished_at: string; rows_updated: number | null };
function stubClient(rows: Row[]) {
  const q = {
    from: () => q, select: () => q, eq: () => q, gte: () => q, order: () => q,
    range: (a: number, b: number) => Promise.resolve({ data: rows.slice(a, b + 1), error: null }),
  };
  return q as never;
}

const NOW = new Date("2026-10-13T20:00:00Z");
const START = cycleStart(NOW);

/** n readings evenly spread over the cycle so far; the counter climbs so the
 *  whole cycle bills `totalMb`, with the last 72h burning `recentMbPerDay`. */
function cycle(n: number, totalMb: number, recentMbPerDay: number): Row[] {
  const span = NOW.getTime() - 3600_000 - START.getTime();
  const recentStart = NOW.getTime() - 72 * 3600_000;
  const recentRaw = (recentMbPerDay * 3) / BILLABLE_RATIO;
  const earlyRaw = totalMb / BILLABLE_RATIO - recentRaw;
  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const t = START.getTime() + (span * i) / (n - 1);
    const raw = t <= recentStart
      ? 50_000 + earlyRaw * ((t - START.getTime()) / (recentStart - START.getTime()))
      : 50_000 + earlyRaw + recentRaw * ((t - recentStart) / (NOW.getTime() - 3600_000 - recentStart));
    rows.push({ finished_at: new Date(t).toISOString(), rows_updated: Math.round(raw) });
  }
  return rows;
}

describe("the gate reads the whole cycle", () => {
  it("sees the newest of 450 readings, not a number frozen at the 200th", async () => {
    const s = await getEgressStatus(stubClient(cycle(450, 4100, 150)), NOW);
    expect(s.readings).toBe(450);
    expect(s.staleHours!).toBeLessThan(2);
    expect(s.pct!).toBeGreaterThan(0.81);
    expect(s.pct!).toBeLessThan(0.83);
  });
});

describe("past the line, shed only when the cycle is heading for the cap", () => {
  it("does NOT throttle bulk at 82% when the burn rate ends the cycle near 88%", async () => {
    const gate = await checkEgressBudget("bulk", stubClient(cycle(450, 4100, 150)), NOW);
    expect(gate.skip).toBe(false);
    expect(gate.reason).toMatch(/not throttling/);
  });

  it("DOES throttle bulk at 82% when the burn rate would hit the cap", async () => {
    const gate = await checkEgressBudget("bulk", stubClient(cycle(450, 4100, 1200)), NOW);
    expect(gate.skip).toBe(true);
  });

  it("reports the projection it decided on", async () => {
    const s = await getEgressStatus(stubClient(cycle(450, 4100, 150)), NOW);
    expect(s.mbPerDay!).toBeGreaterThan(120);
    expect(s.mbPerDay!).toBeLessThan(180);
    expect(s.projectedPct!).toBeGreaterThan(0.86);
    expect(s.projectedPct!).toBeLessThan(0.91);
  });
});
