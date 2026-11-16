/**
 * The if/then rules behind the dead-session failsafe (scripts/lib/review-dates.mjs).
 * Guards the exact judgment that retires a bill: session over + never passed +
 * no fresh action → dead; and the revival guard that protects a revolving bill.
 */
import { describe, it, expect } from "vitest";
import { computeBillReviewBy, matchSession, sessionEnded, sessionFlag, sessionReviewBy, shouldRetire, shouldRevive, LAW_KEEP_STATUSES } from "../scripts/lib/review-dates.mjs";

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

describe("sessionFlag: the rows the 2026-11-06 audit sorted", () => {
  const LATE_2026 = Date.parse("2026-11-06T00:00:00Z");
  const flag = (bill: Record<string, unknown>, rows: unknown[], now = LATE_2026) => sessionFlag(bill, rows, { now });

  const ga = [{ legiscan_session_id: 2167, session_name: "2025-2026 Regular Session", year_start: 2025, year_end: 2026, special: false, sine_die: true }];
  const il = [
    { legiscan_session_id: 2176, session_name: "104th General Assembly", year_start: 2025, year_end: 2026, special: false, sine_die: true },
    { legiscan_session_id: 2020, session_name: "103rd General Assembly", year_start: 2023, year_end: 2024, special: false, sine_die: true },
    { legiscan_session_id: 1644, session_name: "101st General Assembly", year_start: 2019, year_end: 2020, special: false, sine_die: true },
  ];
  const nd = [{ legiscan_session_id: 2140, session_name: "69th Legislative Assembly", year_start: 2025, year_end: 2026, special: false, sine_die: true }];
  const ny = [{ legiscan_session_id: 2188, session_name: "2025-2026 General Assembly", year_start: 2025, year_end: 2026, special: false, sine_die: true }];

  it("flags GA HB 968, which died with the term", () => {
    expect(flag({ state: "GA", scope: "state", bill_number: "HB 968", session_id: "2167", status: "introduced", last_action: "House Committee Favorably Reported By Substitute", last_action_at: "2026-03-06" }, ga)).toBe(true);
  });

  it("gives a city or county row no session, even with a year in its label", () => {
    const local = { state: "GA", session_id: "2026", status: "introduced", last_action_at: "2026-06-06" };
    expect(flag({ ...local, scope: "municipal" }, ga)).toBe(false);
    expect(flag({ ...local, scope: "county" }, ga)).toBe(false);
  });

  it("matches a numbered Assembly to its own session, not the year of a stapled action", () => {
    expect(matchSession({ session_id: "101st", last_action_at: "2026-07-02" }, il)?.legiscan_session_id).toBe(1644);
  });

  it("won't claim a session for a row wearing another bill's actions (IL SB 3357)", () => {
    expect(flag({ state: "IL", scope: "state", session_id: "101st", status: "introduced", last_action_at: "2026-07-02" }, il)).toBe(false);
    expect(flag({ state: "IL", scope: "state", session_id: "103rd", status: "introduced", last_action_at: "2025-03-21" }, il)).toBe(false);
  });

  it("still lets a bill act the year before its session", () => {
    const ok = [{ legiscan_session_id: 2219, session_name: "2026 Regular Session", year_start: 2026, year_end: 2026, special: false, sine_die: true }];
    expect(flag({ state: "OK", scope: "state", session_id: "2026", status: "committee", last_action_at: "2025-02-04" }, ok)).toBe(true);
  });

  it("holds Illinois open until the Assembly's term is over", () => {
    const bill = { state: "IL", scope: "state", session_id: "2176", status: "introduced", last_action_at: "2026-03-27" };
    expect(flag(bill, il)).toBe(false);
    expect(flag(bill, il, Date.parse("2027-02-01T00:00:00Z"))).toBe(true);
  });

  it("doesn't flag a bill whose last action is its outcome (ND HB 1628)", () => {
    const bill = { state: "ND", scope: "state", session_id: "69", status: "introduced", last_action: "Filed with Secretary Of State 09/04", last_action_at: "2026-09-15" };
    expect(sessionEnded(bill, nd, { now: LATE_2026 })).toBe(true);
    expect(flag(bill, nd)).toBe(false);
  });

  it("doesn't flag an adopted one-chamber resolution (LA HR 177), but does a joint one", () => {
    const la = [{ legiscan_session_id: 1527, session_name: "2018 Regular Session", year_start: 2018, year_end: 2018, special: false, sine_die: true }];
    const row = { state: "LA", scope: "state", session_id: "2018", status: "passed_chamber", last_action_at: "2018-05-18" };
    expect(flag({ ...row, bill_number: "HR 177" }, la)).toBe(false);
    expect(flag({ ...row, bill_number: "HJR 12" }, la)).toBe(true);
  });

  it("neither flags nor retires a bill waiting on the governor (NY S 8925)", () => {
    const bill = { state: "NY", scope: "state", session_id: "2188", status: "in_committee", last_action: "returned to senate", last_action_at: "2026-06-05" };
    expect(sessionEnded(bill, ny, { now: LATE_2026 })).toBe(false);
    expect(flag(bill, ny)).toBe(false);
  });

  it("keeps the flag on a companion: its session did end", () => {
    expect(flag({ state: "NY", scope: "state", session_id: "2188", status: "introduced", last_action: "substituted by s8925a", last_action_at: "2026-06-03" }, ny)).toBe(true);
  });

  it("works out a past Congress from its number, with no session rows", () => {
    expect(flag({ state: "US", scope: "federal", session_id: "118", status: "committee" }, [])).toBe(true);
    expect(flag({ state: "US", scope: "federal", session_id: "119", status: "committee" }, [])).toBe(false);
    expect(flag({ state: "US", scope: "federal", session_id: "119", status: "committee" }, [], Date.parse("2027-02-01T00:00:00Z"))).toBe(true);
    expect(flag({ state: "US", scope: "federal", session_id: null, status: "committee" }, [])).toBe(false);
  });

  it("claims nothing without a session row or a date", () => {
    expect(flag({ state: "GA", scope: "state", session_id: "2167", status: "introduced", last_action_at: null }, ga)).toBe(false);
    expect(flag({ state: "GA", scope: "state", session_id: "2167", status: "introduced", last_action_at: "2026-03-06" }, [])).toBe(false);
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
