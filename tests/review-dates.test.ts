/**
 * The if/then rules behind the dead-session failsafe (scripts/lib/review-dates.mjs).
 * Guards the exact judgment that retires a bill: session over + never passed +
 * no fresh action → dead; and the revival guard that protects a revolving bill.
 */
import { describe, it, expect } from "vitest";
import { computeBillReviewBy, matchSession, sessionReviewBy, shouldRetire, shouldRevive, LAW_KEEP_STATUSES } from "../scripts/lib/review-dates.mjs";

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

describe("matchSession", () => {
  // TN's rows as legislative_sessions holds them on 2026-11-03.
  const tn = [
    { legiscan_session_id: 2161, year_start: 2025, year_end: 2026, special: false, sine_die: true },
    { legiscan_session_id: 2199, year_start: 2025, year_end: 2025, special: true, sine_die: true },
    { legiscan_session_id: 1777, year_start: 2021, year_end: 2022, special: false, sine_die: true },
  ];
  it("matches a LegiScan session id, which holds no year", () => {
    expect(matchSession({ session_id: "2161" }, tn)?.legiscan_session_id).toBe(2161);
    expect(sessionReviewBy({ session_id: "2161" }, matchSession({ session_id: "2161" }, tn))).toBe("2026-12-31T23:59:59.000Z");
  });
  it("matches a General Assembly number by the year of the last action", () => {
    expect(matchSession({ session_id: "114", last_action_at: "2025-04-03" }, tn)?.legiscan_session_id).toBe(2161);
  });
  it("prefers the regular session to a special one in the same year", () => {
    expect(matchSession({ session_id: "2025" }, tn)?.legiscan_session_id).toBe(2161);
  });
  it("returns null with no rows or nothing to match on", () => {
    expect(matchSession({ session_id: "2161" }, [])).toBeNull();
    expect(matchSession({ session_id: "suffolk-special" }, tn)).toBeNull();
  });
});

describe("shouldRevive after a retirement", () => {
  it("revives a bill that moved after we retired it, even in an adjourned session", () => {
    const b = { status: "introduced", review_by: "2026-12-31T23:59:59.000Z", last_action_at: daysAgo(2) };
    expect(shouldRevive(b, { sineDie: true, now: NOW, retiredOn: "2026-07-01" })).toBe(true);
  });
  it("leaves a dead bill and an old action alone", () => {
    expect(shouldRevive({ status: "dead", last_action_at: daysAgo(2) }, { sineDie: true, now: NOW, retiredOn: "2026-07-01" })).toBe(false);
    expect(shouldRevive({ status: "introduced", last_action_at: daysAgo(40) }, { sineDie: true, now: NOW, retiredOn: "2026-07-01" })).toBe(false);
  });
});
