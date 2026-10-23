import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tiersForProvider } from "../src/lib/email/provider-limits";

/**
 * The "Is my email account safe?" note (owner ask 2026-10-22) must show the
 * limits the send queue actually keeps. It reads them from provider-limits.ts;
 * these tests stop anyone hard-coding a number into the note, and pin the
 * figures members were told on launch day.
 */
const note = readFileSync(new URL("../src/components/EmailSafetyNote.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../src/modules/campaigns/components/CampaignAction.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../src/app/account/page.tsx", import.meta.url), "utf8");

describe("EmailSafetyNote", () => {
  it("reads every number from provider-limits, never hard-codes one", () => {
    expect(note).toMatch(/tiersForProvider\("gmail"\)/);
    expect(note).toMatch(/tiersForProvider\("outlook"\)/);
    // Ignore styling (Tailwind's text-zinc-500 etc.), check the words only.
    const text = note.replace(/className=(\{`[^`]*`\}|"[^"]*")/g, "");
    expect(text).not.toMatch(/\b(300|425|500|1,?700|2,?000|255|8,?500|10,?000)\b/);
  });

  it("the limits it shows are the ones the queue enforces", () => {
    const by = Object.fromEntries([...tiersForProvider("gmail"), ...tiersForProvider("outlook")].map((t) => [t.tier, t]));
    expect([by.gmail_free.documentedDaily, by.gmail_free.effectiveDaily, by.gmail_free.maxPerMinute]).toEqual([500, 425, 60]);
    expect([by.gmail_workspace.documentedDaily, by.gmail_workspace.effectiveDaily]).toEqual([2000, 1700]);
    expect([by.outlook_consumer.documentedDaily, by.outlook_consumer.effectiveDaily, by.outlook_consumer.maxPerMinute]).toEqual([300, 255, 30]);
  });

  it("is shown where people connect and where they send", () => {
    expect(action.match(/<EmailSafetyNote collapsed/g)).toHaveLength(2);
    expect(account).toMatch(/<EmailSafetyNote className="mt-4" \/>/);
  });
});

describe("daily allowance bar", () => {
  const panel = readFileSync(new URL("../src/modules/campaigns/components/SendBatchPanel.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/modules/campaigns/send-batch-actions.ts", import.meta.url), "utf8");

  it("counts exactly what the queue counts: one-click sends in the last 24 hours, against the safe limit", () => {
    const fn = actions.slice(actions.indexOf("export async function getSendAllowance"));
    expect(fn).toMatch(/\.eq\("method", "platform_email"\)/);
    expect(fn).toMatch(/86_400_000/);
    expect(fn).toMatch(/limit: limits\.effectiveDaily/);
  });

  it("is shown on the send card and refreshes as letters go out", () => {
    expect(panel).toMatch(/<AllowanceBar a=\{allowance\} \/>/);
    expect(panel).toMatch(/\}, \[sentSoFar\]\);/);
  });
});

