/**
 * The LegiScan sync's session guard, and what the restore reads a row's own
 * bill from. Every case is a real row: 12 Illinois kratom bills, NE LB 972 and
 * TN HB 861 showed unrelated newer bills because the old guard read only
 * four-digit years and let the next session through (2026-11-08).
 */
import { describe, it, expect } from "vitest";
import {
  labelYears,
  sessionsForLabel,
  sessionMismatch,
  normBillNumber,
  statusFromOwnLegiscanBill,
  actionInSession,
} from "../scripts/lib/bill-session.mjs";

const IL = [
  { legiscan_session_id: 1630, session_name: "101st General Assembly", year_start: 2019, year_end: 2020, special: false },
  { legiscan_session_id: 2020, session_name: "103rd General Assembly", year_start: 2023, year_end: 2024, special: false },
  { legiscan_session_id: 2176, session_name: "104th General Assembly", year_start: 2025, year_end: 2026, special: false },
];
const NE = [
  { legiscan_session_id: 2152, session_name: "108th Legislature 1st Special Session", year_start: 2024, year_end: 2024, special: true },
  { legiscan_session_id: 2028, session_name: "108th Legislature", year_start: 2023, year_end: 2024, special: false },
  { legiscan_session_id: 2185, session_name: "109th Legislature", year_start: 2025, year_end: 2026, special: false },
];
const ID = [
  { legiscan_session_id: 1766, session_name: "2020 Special Session", year_start: 2020, year_end: 2020, special: true },
  { legiscan_session_id: 1725, session_name: "2020 Regular Session", year_start: 2020, year_end: 2020, special: false },
];
const OK = [
  { legiscan_session_id: 2165, session_name: "2025 Regular Session", year_start: 2025, year_end: 2025, special: false },
  { legiscan_session_id: 2219, session_name: "2026 Regular Session", year_start: 2026, year_end: 2026, special: false },
];
const IL_104 = { year_start: 2025, year_end: 2026 };

describe("labelYears", () => {
  it("reads ranges, single years and short second years", () => {
    expect(labelYears("2019-2020")).toEqual({ year_start: 2019, year_end: 2020 });
    expect(labelYears("2021")).toEqual({ year_start: 2021, year_end: 2021 });
    expect(labelYears("2017_18")).toEqual({ year_start: 2017, year_end: 2018 });
    expect(labelYears("2025rs")).toEqual({ year_start: 2025, year_end: 2025 });
  });
  it("finds no year in an ordinal or a LegiScan id", () => {
    expect(labelYears("101st")).toBeNull();
    expect(labelYears("2176")).toBeNull();
  });
});

describe("sessionsForLabel", () => {
  it("matches an Illinois ordinal to its General Assembly", () => {
    expect(sessionsForLabel("101st", IL).map((s) => s.legiscan_session_id)).toEqual([1630]);
  });
  it("matches a LegiScan session id", () => {
    expect(sessionsForLabel("2176", IL).map((s) => s.legiscan_session_id)).toEqual([2176]);
  });
  it("puts the regular session ahead of a special one", () => {
    expect(sessionsForLabel("2020", ID).map((s) => s.legiscan_session_id)).toEqual([1725, 1766]);
    expect(sessionsForLabel("108", NE)[0].legiscan_session_id).toBe(2028);
  });
});

describe("sessionMismatch", () => {
  it("blocks an old Illinois Assembly from taking the 104th's bill", () => {
    expect(sessionMismatch("101st", IL_104, IL)).toBe(true);
    expect(sessionMismatch("103rd", IL_104, IL)).toBe(true); // the next biennium used to pass
  });
  it("blocks NE LB 972 (108th) from the 109th's motor-vehicle bill", () => {
    expect(sessionMismatch("108", { year_start: 2025, year_end: 2026 }, NE)).toBe(true);
  });
  it("blocks a one-year label from a bill two years on", () => {
    expect(sessionMismatch("2021", { year_start: 2025, year_end: 2025 }, [])).toBe(true);
    expect(sessionMismatch("2017_18", { year_start: 2025, year_end: 2026 }, [])).toBe(true);
  });
  it("lets a row take its own session's bill", () => {
    expect(sessionMismatch("101st", { year_start: 2019, year_end: 2020 }, IL)).toBe(false);
    expect(sessionMismatch("2176", IL_104, IL)).toBe(false);
    expect(sessionMismatch("2019-2020", { year_start: 2019, year_end: 2020 }, [])).toBe(false);
  });
  it("allows a one-year label to be a year off", () => {
    expect(sessionMismatch("2022", { year_start: 2021, year_end: 2021 }, [])).toBe(false); // OK HB 1784
    expect(sessionMismatch("2027", { year_start: 2026, year_end: 2026 }, [])).toBe(false); // VA, continued
    expect(sessionMismatch("2219", { year_start: 2025, year_end: 2025 }, OK)).toBe(false); // carried over
  });
  it("reads \"2020\" in Illinois as both a year and the 103rd GA", () => {
    expect(sessionMismatch("2020", { year_start: 2023, year_end: 2024 }, IL)).toBe(false);
    expect(sessionMismatch("2020", IL_104, IL)).toBe(true);
  });
  it("never blocks on a label it can't read", () => {
    expect(sessionMismatch("222", IL_104, [])).toBe(false);
    expect(sessionMismatch(null, IL_104, IL)).toBe(false);
    expect(sessionMismatch("101st", {}, IL)).toBe(false);
  });
});

describe("normBillNumber", () => {
  it("treats spacing, case and leading zeros as one number", () => {
    expect(normBillNumber("H 0168")).toBe("H168");
    expect(normBillNumber("hb 622")).toBe("HB622");
    expect(normBillNumber("HB0622")).toBe("HB622");
    expect(normBillNumber("SB 10")).toBe("SB10");
  });
});

const bill = (status: number, ...actions: [string, string][]) => ({
  status,
  history: actions.map(([date, action]) => ({ date, action })),
});

describe("statusFromOwnLegiscanBill", () => {
  it("finds the law in its history (IL HB 5526, Public Act 98-0981)", () => {
    const b = bill(4, ["2014-05-22", "Passed Both Houses"], ["2014-08-18", "Governor Approved"], ["2014-08-18", "Effective Date January 1, 2015"]);
    expect(statusFromOwnLegiscanBill(b, "HB 5526")).toBe("enacted");
  });
  it("lets a terminal action win over a later procedural one", () => {
    const b = bill(1, ["2024-05-16", "Approved by the Governor - Chapter 748"], ["2024-05-20", "Hearing 5/30"]);
    expect(statusFromOwnLegiscanBill(b, "HB 1229")).toBe("enacted");
  });
  it("keeps an adopted one-chamber resolution at passed_chamber", () => {
    const b = bill(4, ["2018-03-27", "House Passed/Adopted"]);
    expect(statusFromOwnLegiscanBill(b, "HR 1160")).toBe("passed_chamber");
  });
  it("reads a recorded end as dead", () => {
    expect(statusFromOwnLegiscanBill(bill(1, ["2024-04-18", "Indefinitely postponed"]), "LB 972")).toBe("dead");
    expect(statusFromOwnLegiscanBill(bill(1, ["2025-01-07", "Session Sine Die"]), "HB 4312")).toBe("dead");
  });
  it("otherwise says how far it got, never dead for being old", () => {
    expect(statusFromOwnLegiscanBill(bill(1, ["2020-02-18", "Referred to Rules Committee"]), "HB 5657")).toBe("committee");
    expect(statusFromOwnLegiscanBill(bill(2, ["2019-03-01", "Arrived in Senate"]), "SB 1")).toBe("passed_chamber");
    expect(statusFromOwnLegiscanBill(bill(1, ["2018-02-15", "House Second Readers"]), "HR 1159")).toBe("introduced");
  });
  it("sorts history by date before reading the last action", () => {
    const b = bill(1, ["2020-02-18", "Referred to Rules Committee"], ["2020-02-17", "First Reading"]);
    expect(statusFromOwnLegiscanBill(b, "HB 1")).toBe("committee");
  });
});

describe("actionInSession", () => {
  it("allows a prefile the year before, not an action after", () => {
    expect(actionInSession("2022-12-01", { year_start: 2023, year_end: 2024 })).toBe(true);
    expect(actionInSession("2025-03-21", { year_start: 2023, year_end: 2024 })).toBe(false);
    expect(actionInSession(null, { year_start: 2023, year_end: 2024 })).toBe(false);
  });
});
