/**
 * msn-content.test.ts — pins the MSN URL→content-API id extraction (the
 * keyless path that unsticks MSN-class article extraction; PR-B).
 */
import { describe, it, expect } from "vitest";
import { msnArticleId } from "../scripts/lib/msn-content.mjs";

describe("msnArticleId", () => {
  it("extracts ar- ids with query noise", () => {
    expect(msnArticleId("https://www.msn.com/en-us/health/other/tennessee-kratom-ban-takes-effect-july-1/ar-AA24hwqs?apiversion=v2&domshim=1")).toBe("AA24hwqs");
  });
  it("extracts vi- (video) ids", () => {
    expect(msnArticleId("https://www.msn.com/en-us/news/politics/x/vi-AA22WRba")).toBe("AA22WRba");
  });
  it("handles non-US locales", () => {
    expect(msnArticleId("https://www.msn.com/en-in/news/world/y/ar-AA232cR0?k=1")).toBe("AA232cR0");
  });
  it("returns null for non-MSN URLs", () => {
    expect(msnArticleId("https://www.wvlt.tv/2026/06/01/kratom-ban/")).toBeNull();
    expect(msnArticleId("https://evil.com/msn.com/ar-FAKE")).toBeNull();
    expect(msnArticleId(null as unknown as string)).toBeNull();
  });
});
