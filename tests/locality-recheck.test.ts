import { describe, it, expect } from "vitest";
import { RECHECK, recheckDue } from "../scripts/lib/locality-intel.mjs";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("locality research re-check", () => {
  it("retries a failed sweep once its wait has passed", () => {
    expect(recheckDue({ sweep_status: "failed", last_attempt_at: daysAgo(RECHECK.failedDays + 1) }, NOW)).toBe(true);
    expect(recheckDue({ sweep_status: "failed", last_attempt_at: daysAgo(10) }, NOW)).toBe(false);
  });
  it("re-sweeps a 'nothing found' result after the quiet window", () => {
    expect(recheckDue({ sweep_status: "swept", legal_status: "no_local_law", swept_at: daysAgo(RECHECK.quietDays + 1) }, NOW)).toBe(true);
    expect(recheckDue({ sweep_status: "swept", legal_status: "uncertain", swept_at: daysAgo(30) }, NOW)).toBe(false);
  });
  it("leaves a confirmed ban or pending measure alone", () => {
    expect(recheckDue({ sweep_status: "swept", legal_status: "banned", swept_at: daysAgo(400) }, NOW)).toBe(false);
    expect(recheckDue({ sweep_status: "swept", legal_status: "pending_measure", swept_at: daysAgo(400) }, NOW)).toBe(false);
  });
  it("never retries a wrong-state row that is not a place", () => {
    expect(recheckDue({ sweep_status: "failed", sweep_note: "not a place in DE: Spokane is in WA", last_attempt_at: daysAgo(400) }, NOW)).toBe(false);
  });
  it("never re-queues a row that is already queued", () => {
    expect(recheckDue({ sweep_status: "queued", last_attempt_at: daysAgo(400) }, NOW)).toBe(false);
  });
});
