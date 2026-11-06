import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { templateAsksForBan } from "../scripts/lib/campaign-eligibility.mjs";
import { explicitBanAsk as jobCopy } from "../scripts/lib/letter-stance.mjs";
import { explicitBanAsk as appCopy } from "@/lib/letter-stance";

const letter = (body: string) => ({ title: "Oklahoma SB 1", subject_template: "Vote on SB 1", body_template: body });

describe("auto-approve never publishes a letter that asks for a ban", () => {
  it("catches the ask in the body", () => {
    expect(templateAsksForBan(letter("Dear Senator, I urge you to ban kratom in Oklahoma."))).toBe(true);
  });
  it("catches the ask in the subject or the title", () => {
    expect(templateAsksForBan({ ...letter("Thank you."), subject_template: "Kratom should be banned" })).toBe(true);
    expect(templateAsksForBan({ ...letter("Thank you."), title: "Please ban kratom" })).toBe(true);
  });
  it("passes the letters we actually send", () => {
    expect(templateAsksForBan(letter("Please vote no on SB 1. Do not ban kratom; regulate it with the KCPA."))).toBe(false);
    expect(templateAsksForBan(letter("I support limits on synthetic 7-OH products while protecting the natural leaf."))).toBe(false);
  });
  it("treats a row with no letter as empty", () => {
    expect(templateAsksForBan({ title: null, subject_template: null, body_template: null })).toBe(false);
  });
  it("the engine reads the letter and checks it before it can approve", () => {
    const src = readFileSync("scripts/auto-approve-campaigns.mjs", "utf8");
    expect(src).toMatch(/\.select\("[^"]*subject_template, body_template"\)/);
    const gate = src.indexOf("if (templateAsksForBan(c))");
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(src.indexOf('return { decision: "approve"'));
  });
});

describe("the app and the jobs share one ban check", () => {
  it("is the same function", () => expect(appCopy).toBe(jobCopy));
});
