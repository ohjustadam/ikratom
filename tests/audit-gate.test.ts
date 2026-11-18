import { describe, expect, it } from "vitest";
import { ALLOW, judgeAudit } from "../scripts/lib/audit-gate.mjs";

const adv = (id: string, severity: string, name = "pkg") => ({
  name,
  severity,
  title: `${name} issue`,
  url: `https://github.com/advisories/${id}`,
});
const report = (vias: unknown[], high: number, critical = 0) => ({
  vulnerabilities: { pkg: { severity: "high", via: vias }, parent: { severity: "high", via: ["pkg"] } },
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical, total: high + critical } },
});
const allow = [{ id: "GHSA-aaaa", until: "2026-12-31", why: "test" }];

describe("judgeAudit", () => {
  it("passes a clean report", () => {
    expect(judgeAudit(report([], 0), allow, "2026-11-18").ok).toBe(true);
  });

  it("passes an allowed advisory before its expiry and names it", () => {
    const r = judgeAudit(report([adv("GHSA-aaaa", "high")], 2), allow, "2026-11-18");
    expect(r.ok).toBe(true);
    expect(r.allowed.map((a) => a.id)).toEqual(["GHSA-aaaa"]);
  });

  it("blocks the same advisory once the exception expires", () => {
    const r = judgeAudit(report([adv("GHSA-aaaa", "high")], 2), allow, "2027-01-01");
    expect(r.ok).toBe(false);
    expect(r.blocking[0].expired).toBe("2026-12-31");
  });

  it("blocks any high or critical advisory not on the list", () => {
    expect(judgeAudit(report([adv("GHSA-bbbb", "high")], 1), allow, "2026-11-18").ok).toBe(false);
    expect(judgeAudit(report([adv("GHSA-cccc", "critical")], 0, 1), allow, "2026-11-18").ok).toBe(false);
  });

  it("ignores moderate advisories", () => {
    expect(judgeAudit(report([adv("GHSA-dddd", "moderate")], 0), allow, "2026-11-18").ok).toBe(true);
  });

  it("fails rather than passing vacuously on an unreadable report", () => {
    expect(judgeAudit({ error: { code: "ENOAUDIT" } }, allow).ok).toBe(false);
    expect(judgeAudit({ vulnerabilities: {} }, allow).ok).toBe(false);
    // counts say high exists but no advisory object can be read
    expect(judgeAudit(report(["pkg"], 3), allow, "2026-11-18").ok).toBe(false);
  });

  it("keeps every real exception short-lived and explained", () => {
    for (const a of ALLOW) {
      expect(a.id).toMatch(/^GHSA-/);
      expect(a.why.length).toBeGreaterThan(40);
      const days = (Date.parse(a.until) - Date.parse("2026-11-18")) / 86_400_000;
      expect(days).toBeLessThanOrEqual(90);
    }
  });
});
