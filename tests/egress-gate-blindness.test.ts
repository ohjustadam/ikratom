/**
 * egress-gate-blindness.test.ts — the load-shedding gate must never read a
 * frozen number as a fresh one.
 *
 * WHY THIS EXISTS (2026-09-17). `egress-budget.mjs` is the only thing standing
 * between a free-tier egress breach and the site being RESTRICTED, and it makes
 * exactly two decisions: how much of the cap is spent, and whether that figure
 * is recent enough to act on. Both come from the same rows.
 *
 * `check-egress-usage.mjs` writes a `scraper_runs` row on EVERY run, including
 * the runs where it could not read the metrics endpoint — those carry a status
 * of "error" and no `rows_updated`. The usage sum already ignored them. The
 * freshness check did not: it took the timestamp of the newest row of any kind.
 *
 * That combination is the dangerous one. A watchdog that runs on schedule but
 * cannot measure anything produced a reading that looked minutes old and never
 * moved, so the gate compared a stale figure against its ceiling, declined to
 * shed anything, and never reached the 48h fail-open branch written for
 * precisely this case. Nothing anywhere said the gate had gone blind.
 *
 * These tests pin the distinction: a row only counts if it carried a reading.
 */
import { describe, it, expect } from "vitest";
import { getEgressStatus, checkEgressBudget, BILLABLE_RATIO } from "../scripts/lib/egress-budget.mjs";

type Row = { finished_at: string; rows_updated: number | null };

/**
 * Minimal stand-in for the PostgREST builder. The real call is a fixed chain
 * (`from → select → eq → gte → order → limit`), so every method returns `this`
 * and the terminal `limit` resolves. Anything the module starts calling that
 * this stub lacks will throw rather than silently pass.
 */
function stubClient(rows: Row[]) {
  const thenable = {
    from: () => thenable,
    select: () => thenable,
    eq: () => thenable,
    gte: () => thenable,
    order: () => thenable,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return thenable as never;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe("egress status ignores runs that measured nothing", () => {
  it("derives freshness from the last row that carried a reading", async () => {
    // Two real readings three days old, then a run an hour ago that failed to
    // read the counter. Freshness must reflect the READING, not the run.
    const status = await getEgressStatus(stubClient([
      { finished_at: hoursAgo(96), rows_updated: 10_000 },
      { finished_at: hoursAgo(72), rows_updated: 14_000 },
      { finished_at: hoursAgo(1), rows_updated: null },
    ]));
    expect(status.readings).toBe(2);
    expect(status.staleHours).not.toBeNull();
    expect(status.staleHours!).toBeGreaterThan(48);
  });

  it("fails open when the readings behind the number have gone stale", async () => {
    // The whole point: with the old behaviour this returned skip=false with a
    // confident-looking pct well under the ceiling, for a number three days old.
    const gate = await checkEgressBudget("bulk", stubClient([
      { finished_at: hoursAgo(96), rows_updated: 10_000 },
      { finished_at: hoursAgo(72), rows_updated: 14_000 },
      { finished_at: hoursAgo(1), rows_updated: null },
    ]));
    expect(gate.skip).toBe(false);
    expect(gate.reason).toMatch(/stale/);
  });

  it("still sheds bulk work on fresh readings over the 70% ceiling", async () => {
    // Guards against "fix" by way of failing open everywhere. 3,600 MB of raw
    // delta is ~1,789 MB billable, i.e. ~36% — under the ceiling.
    const under = await checkEgressBudget("bulk", stubClient([
      { finished_at: hoursAgo(24), rows_updated: 10_000 },
      { finished_at: hoursAgo(1), rows_updated: 13_600 },
    ]));
    expect(under.skip).toBe(false);

    // 7,600 MB of raw delta is ~3,777 MB billable, i.e. ~76% — over it.
    const over = await checkEgressBudget("bulk", stubClient([
      { finished_at: hoursAgo(24), rows_updated: 10_000 },
      { finished_at: hoursAgo(1), rows_updated: 17_600 },
    ]));
    expect(over.skip).toBe(true);
    expect(over.pct).toBeGreaterThan(0.7);
  });

  it("reports unknown, not zero, when only one real reading exists", async () => {
    // One reading cannot yield a delta. Saying "unknown" is what routes the
    // caller to the documented fail-open path instead of inventing a 0%.
    const status = await getEgressStatus(stubClient([
      { finished_at: hoursAgo(2), rows_updated: 12_000 },
      { finished_at: hoursAgo(1), rows_updated: null },
    ]));
    expect(status.pct).toBeNull();
    expect(status.usedMb).toBeNull();
  });

  it("counts a counter reset as the new reading, not a negative delta", async () => {
    // The transmit counter is cumulative since instance start, so a restart
    // makes it drop. Subtracting would credit us egress we actually spent.
    const status = await getEgressStatus(stubClient([
      { finished_at: hoursAgo(48), rows_updated: 9_000 },
      { finished_at: hoursAgo(24), rows_updated: 11_000 },
      { finished_at: hoursAgo(1), rows_updated: 500 },
    ]));
    // (11000-9000) + 500 = 2500 raw MB.
    expect(status.usedMb).toBeCloseTo(2500 * BILLABLE_RATIO, 5);
  });
});
