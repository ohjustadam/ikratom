import { describe, it, expect } from "vitest";
import { postElectionSweep } from "../scripts/lib/local-roster-sweep.mjs";

const at = (iso: string) => Date.parse(iso);

describe("postElectionSweep", () => {
  it("runs from January 2 to March 31 after an even-year general", () => {
    expect(postElectionSweep(at("2027-01-02T12:00:00Z"))?.since).toBe(at("2027-01-02T00:00:00Z"));
    expect(postElectionSweep(at("2027-03-31T12:00:00Z"))).not.toBeNull();
  });

  it("stays off the rest of the time", () => {
    expect(postElectionSweep(at("2027-01-01T12:00:00Z"))).toBeNull();
    expect(postElectionSweep(at("2027-04-01T12:00:00Z"))).toBeNull();
    expect(postElectionSweep(at("2026-11-06T12:00:00Z"))).toBeNull();
    expect(postElectionSweep(at("2028-02-01T12:00:00Z"))).toBeNull();
  });
});
