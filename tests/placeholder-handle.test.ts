import { describe, expect, it } from "vitest";
import { checkHandleShape, isPlaceholderHandle } from "@/lib/placeholder-handle";

describe("isPlaceholderHandle", () => {
  it("spots the automatic handle, with or without @", () => {
    expect(isPlaceholderHandle("member_3f9a2c1b0d")).toBe(true);
    expect(isPlaceholderHandle("@member_3f9a2c1b0d")).toBe(true);
  });
  it("leaves handles people chose alone", () => {
    expect(isPlaceholderHandle("member_jane")).toBe(false);
    expect(isPlaceholderHandle("kratom_kim")).toBe(false);
    expect(isPlaceholderHandle("member_3f9a2c1b0d1")).toBe(false);
    expect(isPlaceholderHandle(null)).toBe(false);
    expect(isPlaceholderHandle("Member")).toBe(false);
  });
});

describe("checkHandleShape", () => {
  it("normalises case and a leading @", () => {
    expect(checkHandleShape(" @Kratom_Kim ")).toEqual({ ok: true, handle: "kratom_kim" });
  });
  it("refuses empty, short, long and odd characters", () => {
    expect(checkHandleShape("").ok).toBe(false);
    expect(checkHandleShape("ab").ok).toBe(false);
    expect(checkHandleShape("a".repeat(31)).ok).toBe(false);
    expect(checkHandleShape("kim.k").ok).toBe(false);
  });
  it("refuses another automatic-looking handle", () => {
    expect(checkHandleShape("member_0123456789").ok).toBe(false);
  });
});
