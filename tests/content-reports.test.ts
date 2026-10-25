import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REPORT_REASONS, REPORT_TARGETS, isReportReason, isReportTarget, isTargetId, targetHref } from "@/modules/reports/types";

/**
 * The ONE report system (migration 0288). The TS vocabulary must equal the
 * table's check constraints, or a ReportButton offers something the database
 * refuses. And no surface may grow a private report table again.
 */
const sql = readFileSync("supabase/migrations/0288_content_reports.sql", "utf8");
const listIn = (constraint: string) => {
  const m = new RegExp(`${constraint} check \\([a-z_]+ in \\(([^)]*)\\)`, "s").exec(sql);
  return (m?.[1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.slice(1, -1));
};

describe("content_reports vocabulary", () => {
  it("targets match the check constraint", () => {
    expect([...REPORT_TARGETS].sort()).toEqual(listIn("content_reports_type_chk").sort());
  });
  it("reasons match the check constraint", () => {
    expect(REPORT_REASONS.map((r) => r.id).sort()).toEqual(listIn("content_reports_reason_chk").sort());
  });
  it("every target is handled by report_content", () => {
    for (const t of REPORT_TARGETS) expect(sql).toContain(`p_type = '${t}'`);
  });
  it("validates inputs like the RPC does", () => {
    expect(isReportTarget("profile")).toBe(true);
    expect(isReportTarget("forum_post")).toBe(false); // the forum keeps its own flow (0022)
    expect(isReportReason("spam")).toBe(true);
    expect(isReportReason("i hate it")).toBe(false);
    expect(isTargetId("dQw4w9WgXcQ")).toBe(true);
    expect(isTargetId("../../etc")).toBe(false);
    for (const t of REPORT_TARGETS) expect(targetHref(t, "x", null) === null || typeof targetHref(t, "x", null) === "string").toBe(true);
  });
});

describe("one report system", () => {
  it("no other migration after 0288 creates a *_reports table for member content", () => {
    const dir = "supabase/migrations";
    const later = readdirSync(dir).filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) > 288 && statSync(join(dir, f)).isFile());
    // The pattern must catch a real one, or this canary passes vacuously.
    expect(sql).toMatch(/create table[^;]*_reports\b/i);
    for (const f of later) {
      expect(readFileSync(join(dir, f), "utf8"), `${f} should extend content_reports instead`).not.toMatch(/create table[^;]*_reports\b/i);
    }
  });
});
