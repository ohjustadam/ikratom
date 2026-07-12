/**
 * The if/then rules behind the dead-session failsafe (scripts/lib/review-dates.mjs).
 * Guards the exact judgment that retires a bill: session over + never passed +
 * no fresh action → dead; and the revival guard that protects a revolving bill.
 */
import { describe, it, expect } from "vitest";
import { computeBillReviewBy, shouldRetire, shouldRevive, LAW_KEEP_STATUSES } from "../scripts/lib/review-dates.mjs";

const NOW = Date.parse("2026-07-11T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("computeBillReviewBy", () => {
  it("uses the session's final year-end", () => {
    expect(computeBillReviewBy("2019-2020")).toBe("2020-12-31T23:59:59.000Z");
    expect(computeBillReviewBy("2025-2026")).toBe("2026-12-31T23:59:59.000Z");
    expect(computeBillReviewBy("2023")).toBe("2023-12-31T23:59:59.000Z");
  });
  it("returns null for missing/garbage sessions", () => {
    expect(computeBillReviewBy(null)).toBeNull();
    expect(computeBillReviewBy("suffolk-special")).toBeNull();
    expect(computeBillReviewBy("1841")).toBeNull(); // garbage year
  });
});

describe("shouldRetire", () => {
  const base = { status: "in_committee", review_by: "2020-12-31T23:59:59.000Z", last_action_at: daysAgo(400) };
  it("retires a non-passed bill once its session is sine_die", () => {
    expect(shouldRetire(base, { sineDie: true, now: NOW })).toBe(true);
  });
  it("retires when review_by lapsed even without sine_die", () => {
    expect(shouldRetire(base, { sineDie: false, now: NOW })).toBe(true);
  });
  it("keeps enacted bills active forever (repeal tracking)", () => {
    expect(shouldRetire({ ...base, status: "enacted" }, { sineDie: true, now: NOW })).toBe(false);
    expect(LAW_KEEP_STATUSES.has("enacted")).toBe(true);
  });
  it("does NOT retire a bill in a still-open session", () => {
    expect(shouldRetire({ ...base, review_by: "2026-12-31T23:59:59.000Z" }, { sineDie: false, now: NOW })).toBe(false);
  });
  it("spares a bill with a fresh action (grace window / revolving guard)", () => {
    expect(shouldRetire({ ...base, last_action_at: daysAgo(5) }, { sineDie: true, now: NOW })).toBe(false);
  });
});

describe("shouldRevive", () => {
  it("revives a retired bill whose session is current + has a fresh action", () => {
    expect(shouldRevive({ review_by: "2026-12-31T23:59:59.000Z", last_action_at: daysAgo(3) }, { sineDie: false, now: NOW })).toBe(true);
  });
  it("does not revive when the session is truly over", () => {
    expect(shouldRevive({ review_by: "2020-12-31T23:59:59.000Z", last_action_at: daysAgo(3) }, { sineDie: false, now: NOW })).toBe(false);
    expect(shouldRevive({ review_by: "2026-12-31T23:59:59.000Z", last_action_at: daysAgo(3) }, { sineDie: true, now: NOW })).toBe(false);
  });
  it("does not revive a stale bill (no fresh action)", () => {
    expect(shouldRevive({ review_by: "2026-12-31T23:59:59.000Z", last_action_at: daysAgo(90) }, { sineDie: false, now: NOW })).toBe(false);
  });
});
