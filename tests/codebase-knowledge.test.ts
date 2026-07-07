import { describe, it, expect } from "vitest";
import { searchCodebase, codebaseDigestStats } from "../src/lib/codebase-knowledge";

describe("codebase knowledge search", () => {
  it("has a populated digest (docs + files)", () => {
    const s = codebaseDigestStats();
    expect(s.files).toBeGreaterThan(100);
    expect(s.docs).toBeGreaterThan(10);
    expect(s.total).toBe(s.docs + s.files);
  });

  it("returns nothing for an empty / stopword-only query", () => {
    expect(searchCodebase("")).toEqual([]);
    expect(searchCodebase("how does the site work")).toEqual([]);
  });

  it("finds the AI editor actions file by feature name", () => {
    const hits = searchCodebase("ai editor tool belt");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.path.includes("ai-editor-actions"))).toBe(true);
  });

  it("finds the entity-edit engine when asked where edits are validated", () => {
    const hits = searchCodebase("entity edit whitelist validation");
    expect(hits.some((h) => h.path.includes("entity-edit"))).toBe(true);
  });

  it("surfaces a route path for an app-router page query", () => {
    const hits = searchCodebase("master edit admin");
    expect(hits.some((h) => h.path.includes("admin/master-edit"))).toBe(true);
  });

  it("ranks a filename match above a body-only mention", () => {
    const hits = searchCodebase("codebase-knowledge");
    expect(hits[0]?.path).toContain("codebase-knowledge");
  });

  it("caps results at the requested limit", () => {
    expect(searchCodebase("admin", 3).length).toBeLessThanOrEqual(3);
  });
});
