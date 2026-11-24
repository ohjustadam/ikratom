import { describe, expect, it } from "vitest";
import { isSendKey } from "@/lib/enter-to-send";

describe("isSendKey", () => {
  it("sends on a plain Enter from a keyboard", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false }, false)).toBe(true);
  });
  it("adds a line on Shift+Enter", () => {
    expect(isSendKey({ key: "Enter", shiftKey: true }, false)).toBe(false);
  });
  it("adds a line on a phone, where there is no Shift+Enter", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false }, true)).toBe(false);
  });
  it("never sends while a word is still composing", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } }, false)).toBe(false);
  });
  it("ignores every other key", () => {
    expect(isSendKey({ key: "a", shiftKey: false }, false)).toBe(false);
  });
  it("falls back to keyboard behaviour where there is no window", () => {
    expect(isSendKey({ key: "Enter", shiftKey: false })).toBe(true);
  });
});
