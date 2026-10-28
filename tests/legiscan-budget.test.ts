import { describe, expect, it } from "vitest";
import {
  LEGISCAN_MONTHLY_CAP, callsFromNotes, monthStart, remainingFor, budgetAllows,
  changeHashesFromMasterList, planBill, createLegiscanClient,
} from "../scripts/lib/legiscan-budget.mjs";

describe("LegiScan budget math", () => {
  it("uses the real 10,000/month cap, not the 30k the code once assumed", () => {
    expect(LEGISCAN_MONTHLY_CAP).toBe(10_000);
  });

  it("reads the call count a job left in its notes", () => {
    expect(callsFromNotes("3 synced, 200 unchanged · legiscan_calls=44")).toBe(44);
    expect(callsFromNotes("texts=0 no-docs=1")).toBe(0);
    expect(callsFromNotes(null)).toBe(0);
  });

  it("counts from the 1st of the calendar month", () => {
    expect(monthStart(new Date("2026-11-17T08:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("lets nonessential jobs run to 70% and the essential sync to 95%", () => {
    expect(remainingFor(0, "nonessential")).toBe(7000);
    expect(remainingFor(6990, "nonessential")).toBe(10);
    expect(budgetAllows(7000, "nonessential")).toBe(false);
    expect(budgetAllows(7000, "essential")).toBe(true);
    expect(remainingFor(9600, "essential")).toBe(0);
  });
});

describe("change-hash gating", () => {
  const master = {
    session: { session_id: 2200, sine_die: 0 },
    0: { bill_id: 101, number: "HB1", change_hash: "aaa" },
    1: { bill_id: 102, number: "SB2", change_hash: "bbb" },
  };
  const hashes = changeHashesFromMasterList(master);

  it("maps every bill in a master list, skipping the session entry", () => {
    expect(hashes.size).toBe(2);
    expect(hashes.get(101)).toBe("aaa");
  });

  it("skips bills whose hash has not moved", () => {
    expect(planBill({ legiscan_bill_id: 101, legiscan_change_hash: "aaa" }, hashes)).toBe("unchanged");
  });

  it("fetches bills whose hash moved, or that were never hashed", () => {
    expect(planBill({ legiscan_bill_id: 102, legiscan_change_hash: "old" }, hashes)).toBe("fetch");
    expect(planBill({ legiscan_bill_id: 102, legiscan_change_hash: null }, hashes)).toBe("fetch");
  });

  it("treats a synced bill missing from the current session as final", () => {
    expect(planBill({ legiscan_bill_id: 999, legiscan_change_hash: "zzz" }, hashes)).toBe("final");
    expect(planBill({ legiscan_bill_id: 999, legiscan_change_hash: null }, hashes)).toBe("fetch");
  });

  it("fetches directly when the state's master list could not be read", () => {
    expect(planBill({ legiscan_bill_id: 101, legiscan_change_hash: "aaa" }, undefined)).toBe("fetch");
  });

  it("re-searches an unfound bill weekly, not every run", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(planBill({ legiscan_bill_id: null, legiscan_searched_at: null }, hashes, { now })).toBe("search");
    expect(planBill({ legiscan_bill_id: null, legiscan_searched_at: "2026-11-08T00:00:00Z" }, hashes, { now })).toBe("wait");
    expect(planBill({ legiscan_bill_id: null, legiscan_searched_at: "2026-11-01T00:00:00Z" }, hashes, { now })).toBe("search");
  });
});

describe("counted client", () => {
  it("refuses to go past its run allowance without calling the API", async () => {
    const c = createLegiscanClient("k", { maxCalls: 0 });
    expect(c.exhausted).toBe(true);
    await expect(c.call("getBill", { id: 1 })).rejects.toThrow(/budget/);
    expect(c.calls).toBe(0);
  });
});
