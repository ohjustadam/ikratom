import { describe, it, expect } from "vitest";
import { seatBanner, longDate, todayEastern, type SeatElection } from "../src/lib/seat-turnover";

/**
 * The profile banner for every seat_elections state. The promise to members is
 * "nobody emails someone who has left office, and nobody is dropped before
 * they leave", so the copy must name the right day and say the official is
 * still contactable until then.
 */
const seat = (over: Partial<SeatElection>): SeatElection => ({
  election_date: "2026-11-03", kind: "regular", status: "on_ballot", handover_date: "2026-11-18", winner_name: null, ...over,
});

describe("seat turnover banner", () => {
  it("before the election: the seat is on the ballot and the handover day is named", () => {
    const b = seatBanner(seat({}), "Jane Doe", "2026-10-23");
    expect(b?.title).toBe("This seat is on the November 3, 2026 ballot");
    expect(b?.detail).toBe("The winner takes office November 18, 2026. Jane Doe serves until then.");
  });

  it("an unproven handover day is never invented", () => {
    expect(seatBanner(seat({ handover_date: null }), "Jane Doe", "2026-10-23")?.detail).toBe("Jane Doe serves until the winner takes office.");
  });

  it("a special election says the winner takes office on certification", () => {
    expect(seatBanner(seat({ kind: "special", handover_date: null }), "Jane Doe", "2026-10-23")?.title).toMatch(/special election/);
  });

  it("after election day with no result yet: results pending, still in office", () => {
    expect(seatBanner(seat({}), "Jane Doe", "2026-11-05")?.title).toBe("Results pending for the November 3, 2026 election");
  });

  it("a successor elected: leaving on the date, contactable until then", () => {
    const b = seatBanner(seat({ status: "successor_elected", winner_name: "John Roe" }), "Jane Doe", "2026-11-06");
    expect(b?.tone).toBe("leaving");
    expect(b?.title).toBe("Leaving office on November 18, 2026");
    expect(b?.detail).toBe("John Roe won this seat on November 3, 2026. Jane Doe is still in office and can be contacted until then.");
    expect(seatBanner(seat({ status: "successor_elected" }), "Jane Doe", "2026-11-19")).toBeNull();
  });

  it("re-elected shows for 60 days, then goes away", () => {
    expect(seatBanner(seat({ status: "incumbent_reelected" }), "Jane Doe", "2026-11-10")?.title).toBe("Re-elected on November 3, 2026");
    expect(seatBanner(seat({ status: "incumbent_reelected" }), "Jane Doe", "2027-01-05")).toBeNull();
  });

  it("an internal review state reads like on_ballot; swapped and cancelled show nothing", () => {
    expect(seatBanner(seat({ status: "needs_review" }), "Jane Doe", "2026-10-23")?.tone).toBe("ballot");
    expect(seatBanner(seat({ status: "swapped" }), "Jane Doe", "2026-10-23")).toBeNull();
    expect(seatBanner(seat({ status: "cancelled" }), "Jane Doe", "2026-10-23")).toBeNull();
    expect(seatBanner(null, "Jane Doe", "2026-10-23")).toBeNull();
  });

  it("dates are calendar days in Eastern time, never shifted by UTC", () => {
    expect(longDate("2027-01-01")).toBe("January 1, 2027");
    // 02:00 UTC on Nov 4 is still Nov 3 in New York.
    expect(todayEastern(new Date("2026-11-04T02:00:00Z"))).toBe("2026-11-03");
  });
});
