/**
 * crawl-brake.test.ts — the thresholds that stop a crawl lift that costs too
 * much, and the guard on raising one. See scripts/lib/crawl-brake.mjs.
 */
import { describe, it, expect } from "vitest";
import { BRAKE_PCT, LIFT_BLOCK_PCT, SPIKE_FLOOR, SPIKE_MULT, evaluateBrake, liftAllowed, medianPassive } from "../scripts/lib/crawl-brake.mjs";

type Day = { date: string; total: number; passive: number };
const days = (passive: number[]): Day[] => passive.map((p, i) => ({ date: `2026-11-${String(i + 1).padStart(2, "0")}`, total: p, passive: p }));
const truth = (used: number, daily: Day[], total = 1000) => ({ ok: true, total, used, byMeter: {}, daily });
const calm = days([...Array(14).fill(15), 15, 16]); // 14 prior days at 15, then two normal days

describe("evaluateBrake", () => {
  it("does nothing at stage 0 and does not need a reading", () => {
    const ev = evaluateBrake({ stage: 0, truth: null });
    expect(ev).toMatchObject({ brake: false, blind: false });
  });

  it("is quiet when the meter is calm", () => {
    const ev = evaluateBrake({ stage: 1, truth: truth(500, calm) });
    expect(ev.brake).toBe(false);
    expect(ev.blind).toBe(false);
  });

  it("brakes at the credit ceiling", () => {
    const ev = evaluateBrake({ stage: 1, truth: truth(1000 * (BRAKE_PCT / 100), calm) });
    expect(ev.brake).toBe(true);
    expect(ev.reasons[0]).toMatch(/credits at 90%/);
    expect(evaluateBrake({ stage: 1, truth: truth(1000 * (BRAKE_PCT / 100) - 1, calm) }).brake).toBe(false);
  });

  it("brakes on a spike in passive burn well above the recent median", () => {
    const spike = days([...Array(14).fill(15), 15, 90]);
    const ev = evaluateBrake({ stage: 2, truth: truth(400, spike) });
    expect(ev.brake).toBe(true);
    expect(ev.reasons[0]).toMatch(/passive burn/);
  });

  it("ignores a busy day under the floor, however many times the median", () => {
    const quiet = days([...Array(14).fill(2), 2, 2 * SPIKE_MULT * 3]); // 15 credits: 7.5x the median, under the floor
    expect(2 * SPIKE_MULT * 3).toBeLessThan(SPIKE_FLOOR);
    expect(evaluateBrake({ stage: 1, truth: truth(300, quiet) }).brake).toBe(false);
  });

  it("is blind, and does not brake, when the meter cannot be read", () => {
    const ev = evaluateBrake({ stage: 1, truth: { ok: false, reason: "netlify 401" } });
    expect(ev).toMatchObject({ brake: false, blind: true });
    expect(ev.note).toMatch(/^BLIND/);
  });

  it("medianPassive takes the 14 complete days before the last two", () => {
    expect(medianPassive(calm)).toBe(15);
    expect(medianPassive([])).toBe(0);
  });
});

describe("liftAllowed", () => {
  it("allows a raise when credits are calm", () => {
    expect(liftAllowed({ truth: truth(500, calm) }).ok).toBe(true);
  });

  it("refuses a raise at or above the guard, unless forced", () => {
    const t = truth(1000 * (LIFT_BLOCK_PCT / 100), calm);
    expect(liftAllowed({ truth: t }).ok).toBe(false);
    expect(liftAllowed({ truth: t, force: true }).ok).toBe(true);
  });

  it("refuses a blind raise, unless forced", () => {
    expect(liftAllowed({ truth: { ok: false, reason: "x" } }).ok).toBe(false);
    expect(liftAllowed({ truth: null, force: true }).ok).toBe(true);
  });

  it("the raise guard sits below the brake, so a lift cannot start inside the brake's range", () => {
    expect(LIFT_BLOCK_PCT).toBeLessThan(BRAKE_PCT);
  });
});
