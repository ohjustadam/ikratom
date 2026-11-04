import { describe, expect, it } from "vitest";
import { congressFor, federalBillNumber } from "../scripts/lib/federal-bills.mjs";

describe("federal bill helpers", () => {
  it("maps LegiScan's US numbers to congress.gov style", () => {
    expect(federalBillNumber("HB8000")).toBe("HR 8000");
    expect(federalBillNumber("SB5383")).toBe("S 5383");
    expect(federalBillNumber("HR 12")).toBe("HRES 12");
    expect(federalBillNumber("SJR4")).toBe("SJRES 4");
    expect(federalBillNumber("XB1")).toBeNull();
  });
  it("names the Congress sitting in a year", () => {
    expect(congressFor(2025)).toBe(119);
    expect(congressFor(2026)).toBe(119);
    expect(congressFor(2027)).toBe(120);
  });
});
